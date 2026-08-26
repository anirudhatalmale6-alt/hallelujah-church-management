<?php
/**
 * Hallelujah In The City - messaging engine
 *
 * Everything that actually builds and delivers a message: the email providers,
 * Twilio, the merge fields, the plain-English error wording, and dispatchMessage()
 * which is the single path every send goes down.
 *
 * It lives apart from messaging.php so that the scheduler cron can use it without
 * dragging in a whole authenticated web request. messaging.php is the front door;
 * this is the machinery behind it.
 */
require_once __DIR__ . '/config.php';

/**
 * Turn the comma-separated attachment path string into real files on disk.
 * Silently drops anything that is not there, so a missing attachment can never
 * stop the message itself from going out.
 */
function collectAttachments($attachmentPath) {
    $files = [];
    foreach ($attachmentPath ? explode(',', $attachmentPath) : [] as $p) {
        $p = trim($p);
        if ($p !== '' && file_exists($p)) {
            $files[] = [
                'path' => $p,
                'name' => basename($p),
                'type' => mime_content_type($p) ?: 'application/octet-stream',
                'data' => file_get_contents($p),
            ];
        }
    }
    return $files;
}

/**
 * Read a provider error out of whatever shape it came back in and turn it into
 * one plain sentence a non-technical person can act on. This is what gets stored
 * against the recipient row, so it has to read like an explanation, not a dump.
 */
function explainEmailError($result) {
    if (!empty($result['error'])) return $result['error'];
    $body = json_decode($result['response'] ?? '', true);
    $msg = '';
    if (!empty($body['errors']) && is_array($body['errors'])) {
        // SendGrid: {"errors":[{"message":"..."}]}
        $msg = implode('; ', array_filter(array_map(fn($e) => $e['message'] ?? '', $body['errors'])));
    } elseif (!empty($body['message'])) {
        // Brevo: {"code":"...","message":"..."}
        $msg = $body['message'];
    }
    if ($msg === '' && !empty($result['curl_error'])) $msg = 'Could not reach the email provider: ' . $result['curl_error'];
    if ($msg === '') $msg = 'Email provider returned HTTP ' . ($result['http_code'] ?? '?') . '. ' . trim((string)($result['response'] ?? ''));

    // The one people actually hit, spelled out properly.
    if (stripos($msg, 'maximum credits exceeded') !== false) {
        $msg = 'The email provider has refused the message because the account has run out of sending credits ("Maximum credits exceeded"). '
             . 'Top up / upgrade that account, or switch the provider in Settings > Messaging.';
    }
    return trim($msg);
}

/**
 * Send one email through whichever provider is selected in Settings.
 *
 * Everything that sends email goes through here so there is a single place that
 * knows which provider is in use, a single place that formats the from address,
 * and a single place that turns a provider failure into a readable reason.
 */
function deliverEmail(array $settings, $to, $toName, $subject, $htmlBody, $attachmentPath = null, $returnDetails = false) {
    $provider = strtolower(trim($settings['msg_email_provider'] ?? '')) ?: 'sendgrid';
    $from     = $settings['msg_from_email'] ?? 'noreply@hallelujahinthecity.org';
    $fromName = $settings['msg_from_name'] ?? 'Hallelujah In The City';

    $fail = function ($why) use ($returnDetails) {
        $r = ['success' => false, 'http_code' => 0, 'response' => '', 'curl_error' => '', 'error' => $why];
        return $returnDetails ? $r : false;
    };

    if ($provider === 'brevo') {
        if (empty($settings['msg_brevo_key'])) return $fail('No Brevo API key is saved in Settings > Messaging.');
        $result = sendEmailBrevo($to, $toName, $from, $fromName, $subject, $htmlBody, $settings['msg_brevo_key'], $attachmentPath);
    } elseif ($provider === 'smtp') {
        if (empty($settings['msg_smtp_host'])) return $fail('No SMTP server is saved in Settings > Messaging.');
        $result = sendEmailSmtp($to, $toName, $from, $fromName, $subject, $htmlBody, $settings, $attachmentPath);
    } else {
        if (empty($settings['msg_sendgrid_key'])) return $fail('No SendGrid API key is saved in Settings > Messaging.');
        $result = sendEmail($to, $toName, $from, $fromName, $subject, $htmlBody, $settings['msg_sendgrid_key'], $attachmentPath, true);
    }

    if (!$returnDetails) return $result['success'];
    if (!$result['success']) $result['error'] = explainEmailError($result);
    return $result;
}

// Brevo (formerly Sendinblue) email sending. Same idea as SendGrid, different
// field names and an "api-key" header instead of a bearer token.
function sendEmailBrevo($to, $toName, $from, $fromName, $subject, $htmlBody, $apiKey, $attachmentPath = null) {
    $data = [
        'sender' => ['email' => $from, 'name' => $fromName],
        'to' => [['email' => $to, 'name' => $toName ?: $to]],
        'subject' => $subject,
        'htmlContent' => $htmlBody,
    ];
    $attachments = [];
    foreach (collectAttachments($attachmentPath) as $f) {
        $attachments[] = ['content' => base64_encode($f['data']), 'name' => $f['name']];
    }
    if ($attachments) $data['attachment'] = $attachments;

    $ch = curl_init('https://api.brevo.com/v3/smtp/email');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_HTTPHEADER => ['api-key: ' . $apiKey, 'Content-Type: application/json', 'Accept: application/json'],
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    return [
        'success' => $httpCode >= 200 && $httpCode < 300,
        'http_code' => $httpCode, 'response' => $response, 'curl_error' => $curlError,
    ];
}

/**
 * Plain SMTP sending, so the church can send through a mailbox it already owns
 * (for example Info@hallelujahinthecity.org on Hostinger) instead of paying an
 * email service. Small hand-rolled client - there is no Composer on this host,
 * so no PHPMailer to lean on.
 */
function sendEmailSmtp($to, $toName, $from, $fromName, $subject, $htmlBody, array $settings, $attachmentPath = null) {
    $host   = trim($settings['msg_smtp_host']);
    $port   = (int)($settings['msg_smtp_port'] ?? 0) ?: 587;
    $user   = $settings['msg_smtp_user'] ?? '';
    $pass   = $settings['msg_smtp_pass'] ?? '';
    $secure = strtolower(trim($settings['msg_smtp_secure'] ?? 'tls')); // ssl | tls | none

    $fail = fn($why) => ['success' => false, 'http_code' => 0, 'response' => '', 'curl_error' => '', 'error' => $why];

    $target = ($secure === 'ssl') ? "ssl://$host:$port" : "$host:$port";
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $sock = @stream_socket_client($target, $errNo, $errStr, 20, STREAM_CLIENT_CONNECT, $ctx);
    if (!$sock) return $fail("Could not connect to $host:$port - $errStr");
    stream_set_timeout($sock, 20);

    // Read one SMTP reply (handles the multi-line "250-" continuation form).
    $read = function () use ($sock) {
        $out = '';
        while (($line = fgets($sock, 1024)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') break;
        }
        return $out;
    };
    $say = function ($cmd) use ($sock, $read) { fwrite($sock, $cmd . "\r\n"); return $read(); };
    $code = fn($r) => (int)substr(trim($r), 0, 3);

    try {
        if ($code($read()) !== 220) return $fail("$host did not accept the connection.");
        $ehloName = $_SERVER['SERVER_NAME'] ?? 'localhost';
        $r = $say("EHLO $ehloName");
        if ($code($r) !== 250) return $fail('SMTP server rejected EHLO: ' . trim($r));

        if ($secure === 'tls') {
            $r = $say('STARTTLS');
            if ($code($r) !== 220) return $fail('SMTP server refused STARTTLS: ' . trim($r));
            if (!@stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                return $fail('Could not start a secure (TLS) connection to ' . $host . '.');
            }
            $say("EHLO $ehloName");
        }

        if ($user !== '') {
            $r = $say('AUTH LOGIN');
            if ($code($r) !== 334) return $fail('SMTP server does not accept AUTH LOGIN: ' . trim($r));
            $r = $say(base64_encode($user));
            if ($code($r) !== 334) return $fail('SMTP server rejected the username: ' . trim($r));
            $r = $say(base64_encode($pass));
            if ($code($r) !== 235) return $fail('SMTP login failed - check the mailbox address and password. Server said: ' . trim($r));
        }

        $r = $say("MAIL FROM:<$from>");
        if ($code($r) !== 250) return $fail("SMTP server refused the from address <$from>: " . trim($r));
        $r = $say("RCPT TO:<$to>");
        if ($code($r) !== 250 && $code($r) !== 251) return $fail("SMTP server refused the address <$to>: " . trim($r));
        $r = $say('DATA');
        if ($code($r) !== 354) return $fail('SMTP server refused DATA: ' . trim($r));

        $boundary = 'hitc' . bin2hex(random_bytes(8));
        $files = collectAttachments($attachmentPath);
        $enc = fn($s) => '=?UTF-8?B?' . base64_encode($s) . '?=';

        $headers = [
            'Date: ' . date('r'),
            'From: ' . $enc($fromName) . " <$from>",
            'To: ' . ($toName ? $enc($toName) . " <$to>" : $to),
            'Subject: ' . $enc((string)$subject),
            'MIME-Version: 1.0',
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . preg_replace('/^.*@/', '', $from) . '>',
        ];
        if ($files) {
            $headers[] = "Content-Type: multipart/mixed; boundary=\"$boundary\"";
            $mime = "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
                  . chunk_split(base64_encode($htmlBody)) . "\r\n";
            foreach ($files as $f) {
                $mime .= "--$boundary\r\nContent-Type: {$f['type']}; name=\"{$f['name']}\"\r\n"
                       . "Content-Transfer-Encoding: base64\r\n"
                       . "Content-Disposition: attachment; filename=\"{$f['name']}\"\r\n\r\n"
                       . chunk_split(base64_encode($f['data'])) . "\r\n";
            }
            $mime .= "--$boundary--\r\n";
        } else {
            $headers[] = 'Content-Type: text/html; charset=UTF-8';
            $headers[] = 'Content-Transfer-Encoding: base64';
            $mime = chunk_split(base64_encode($htmlBody));
        }

        // A line that is just "." would end the message early, so it has to be escaped.
        $body = preg_replace('/^\./m', '..', $mime);
        fwrite($sock, implode("\r\n", $headers) . "\r\n\r\n" . $body . "\r\n.\r\n");
        $r = $read();
        $say('QUIT');
        fclose($sock);

        if ($code($r) !== 250) return $fail('SMTP server did not accept the message: ' . trim($r));
        return ['success' => true, 'http_code' => 250, 'response' => trim($r), 'curl_error' => ''];
    } catch (Exception $e) {
        if (is_resource($sock)) fclose($sock);
        return $fail('SMTP error: ' . $e->getMessage());
    }
}

// SendGrid email sending
function sendEmail($to, $toName, $from, $fromName, $subject, $htmlBody, $apiKey, $attachmentPath = null, $returnDetails = false) {
    $data = [
        'personalizations' => [['to' => [['email' => $to, 'name' => $toName]]]],
        'from' => ['email' => $from, 'name' => $fromName],
        'subject' => $subject,
        'content' => [['type' => 'text/html', 'value' => $htmlBody]],
    ];
    // Support multiple attachments (comma-separated paths)
    $paths = $attachmentPath ? explode(',', $attachmentPath) : [];
    $attachments = [];
    foreach ($paths as $p) {
        $p = trim($p);
        if ($p && file_exists($p)) {
            $attachments[] = [
                'content' => base64_encode(file_get_contents($p)),
                'filename' => basename($p),
                'type' => mime_content_type($p) ?: 'application/octet-stream',
            ];
        }
    }
    if (!empty($attachments)) $data['attachments'] = $attachments;
    $ch = curl_init('https://api.sendgrid.com/v3/mail/send');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ],
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    $success = $httpCode >= 200 && $httpCode < 300;
    if ($returnDetails) {
        return ['success' => $success, 'http_code' => $httpCode, 'response' => $response, 'curl_error' => $curlError];
    }
    return $success;
}

// Format phone to E.164
function formatPhone($phone) {
    $digits = preg_replace('/[^0-9]/', '', $phone);
    if (strlen($digits) === 10) return '+1' . $digits;
    if (strlen($digits) === 11 && $digits[0] === '1') return '+' . $digits;
    if (strpos($phone, '+') === 0) return $phone;
    return '+1' . $digits;
}

// Turn a Twilio refusal into one sentence the pastor can act on. Twilio's own
// wording ("Invalid From Number (caller ID)") reads like the RECIPIENT's number
// is wrong, when in fact the problem is the church's own sending number in
// Settings - which is what made a whole broadcast look like bad member data.
function explainSmsError($response, $curlError = '', $fromNumber = '') {
    $body = json_decode((string)$response, true);
    $code = is_array($body) ? (int)($body['code'] ?? 0) : 0;
    $msg  = is_array($body) ? trim((string)($body['message'] ?? '')) : '';
    $from = $fromNumber !== '' ? $fromNumber : 'the number saved in Settings';

    switch ($code) {
        case 21212: // From is not a valid phone number / not on this account
        case 21606: // From is not a valid, SMS-capable number for this account
        case 21210: // From is not verified for this account
            return 'The church text number in Settings > Messaging (' . $from . ') is not a working sending '
                 . 'number on your Twilio account, so Twilio refused every text. This is the SENDING number, '
                 . 'not the member\'s number. Fix it in Settings > Messaging and send again.';
        case 21266: // To == From
            return 'Twilio will not text a number from itself. The "send me a copy" number in '
                 . 'Settings > Messaging is the same as the church text number - change one of them.';
        case 21211:
            return 'This person\'s phone number is not a valid number, so it could not be texted. '
                 . 'Check the number on their profile.';
        case 21610:
            return 'This person replied STOP to a previous text, so Twilio blocks any further texts to them. '
                 . 'They have to text START to opt back in.';
        case 21614:
            return 'This number cannot receive texts (it looks like a landline).';
        case 30034:
            return 'Twilio blocked the text because the church number is not registered for A2P 10DLC yet.';
        case 20003:
            return 'Twilio rejected the login. Check the Account SID and Auth Token in Settings > Messaging.';
    }
    if ($msg !== '') return $msg;
    return $curlError !== '' ? $curlError : 'Unknown error';
}

// The SMS-capable numbers this Twilio account actually owns. Returns [] on any
// problem - this only ever feeds a helper list, it must never block a save.
function twilioOwnedNumbers($accountSid, $authToken) {
    $ch = curl_init("https://api.twilio.com/2010-04-01/Accounts/$accountSid/IncomingPhoneNumbers.json?PageSize=50");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERPWD => "$accountSid:$authToken",
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200) return [];
    $j = json_decode($resp, true);
    if (!isset($j['incoming_phone_numbers'])) return [];
    $out = [];
    foreach ($j['incoming_phone_numbers'] as $n) {
        if (empty($n['capabilities']['sms'])) continue;
        $out[] = ['number' => $n['phone_number'] ?? '', 'label' => $n['friendly_name'] ?? ($n['phone_number'] ?? '')];
    }
    return $out;
}

// Twilio SMS/MMS sending
function sendSMS($to, $body, $accountSid, $authToken, $fromNumber, $mediaUrl = null, $returnDetails = false) {
    $to = formatPhone($to);
    // Normalise the sender too. It used to be passed through exactly as typed,
    // so "(267) 433-2021" or a number pasted without the +1 was refused by Twilio.
    $fromNumber = trim((string)$fromNumber);
    if ($fromNumber !== '' && strpos($fromNumber, '+') !== 0) $fromNumber = formatPhone($fromNumber);
    $url = "https://api.twilio.com/2010-04-01/Accounts/$accountSid/Messages.json";
    $data = ['To' => $to, 'From' => $fromNumber, 'Body' => $body];
    if ($mediaUrl) $data['MediaUrl'] = $mediaUrl;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_POSTFIELDS => http_build_query($data),
        CURLOPT_USERPWD => "$accountSid:$authToken",
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    $success = $httpCode >= 200 && $httpCode < 300;
    if ($returnDetails) {
        return ['success' => $success, 'http_code' => $httpCode, 'response' => $response, 'curl_error' => $curlError];
    }
    return $success;
}

// Get messaging settings
function getMessagingSettings($db) {
    $settings = [];
    try {
        $rows = $db->query("SELECT `key` as k, `value` as v FROM settings WHERE `key` LIKE 'msg_%'")->fetchAll();
        foreach ($rows as $r) $settings[$r['k']] = $r['v'];
    } catch (Exception $e) {}
    return $settings;
}

// --- Message wording -------------------------------------------------------
// The thank-you and pledge-reminder wording lives in the settings table under
// msg_tpl_*, so it travels with the rest of the messaging settings and needs no
// new table. A blank saved value means "fall back to the wording below", which
// is also how the Reset button works - it simply saves blank.
function defaultMessageTemplates() {
    return [
        'msg_tpl_thanks_sms' =>
            "Thank you {first name}! We received your gift of {amount} toward {fund}. "
            . "It is a real blessing to this church. God bless you. - {church}",
        'msg_tpl_thanks_subject' => "Thank you for your gift, {first name}",
        'msg_tpl_thanks_body' =>
            "Dear {first name},\n\n"
            . "Thank you for your gift of {amount} toward {fund}, received on {date}.\n\n"
            . "Your giving keeps the work of this church going, and we do not take it for granted.\n\n"
            . "God bless you,\n{church}",
        'msg_tpl_reminder_sms' =>
            "Hello {first name}, a gentle reminder about your {frequency} pledge of {pledge amount} "
            . "toward {fund}. The balance outstanding so far is {amount behind}. "
            . "Thank you for standing with us. - {church}",
        'msg_tpl_reminder_subject' => "A gentle reminder about your pledge",
        'msg_tpl_reminder_body' =>
            "Dear {first name},\n\n"
            . "This is a gentle reminder about your {frequency} pledge of {pledge amount} toward {fund}.\n\n"
            . "So far the balance outstanding is {amount behind}.\n\n"
            . "There is no pressure at all - we only want to make it easy for you to keep up with what "
            . "you set out to give. If anything has changed for you, please just let us know.\n\n"
            . "God bless you,\n{church}",
    ];
}

// Every placeholder the wording is allowed to use. Anything not on this list is
// left alone, so an ordinary { in someone's writing is never touched.
function mergeFieldNames() {
    return ['first name', 'last name', 'full name', 'church',
            'amount', 'fund', 'date',
            'pledge amount', 'frequency', 'amount behind', 'total given'];
}

function getMessageTemplates($db) {
    $saved = getMessagingSettings($db);
    $out = [];
    foreach (defaultMessageTemplates() as $k => $default) {
        $v = isset($saved[$k]) ? (string)$saved[$k] : '';
        $out[$k] = trim($v) !== '' ? $v : $default;
    }
    return $out;
}

// Fill the placeholders for ONE person. Both spellings work - {first name} and
// {first_name} - because both get typed.
function applyMergeFields($text, array $vars) {
    $text = (string)$text;
    if ($text === '' || strpos($text, '{') === false) return $text;
    $replace = [];
    foreach ($vars as $name => $value) {
        $value = is_scalar($value) ? (string)$value : '';
        $replace['{' . $name . '}'] = $value;
        $replace['{' . str_replace(' ', '_', $name) . '}'] = $value;
    }
    return strtr($text, $replace);
}

// Build that person's values. EVERY known field is seeded blank first, so a
// placeholder with nothing behind it comes out empty rather than reaching a
// member as the literal text {amount behind}.
function mergeVarsForRecipient($recp, array $extraByMember, $churchName) {
    $vars = [];
    foreach (mergeFieldNames() as $f) $vars[$f] = '';

    $full = trim((string)($recp['name'] ?? ''));
    $parts = preg_split('/\s+/', $full, 2);
    $vars['first name'] = $parts[0] ?? '';
    $vars['last name']  = $parts[1] ?? '';
    $vars['full name']  = $full;
    $vars['church']     = $churchName;

    $mid = !empty($recp['member_id']) ? (string)(int)$recp['member_id'] : '';
    if ($mid !== '' && !empty($extraByMember[$mid]) && is_array($extraByMember[$mid])) {
        foreach ($extraByMember[$mid] as $k => $v) {
            $key = str_replace('_', ' ', (string)$k);
            if (array_key_exists($key, $vars) && is_scalar($v)) $vars[$key] = (string)$v;
        }
    }
    return $vars;
}

// Send a monitoring copy of an outgoing message to the church / admin, when the
// pastor has switched it on in Settings. Deliberately ONE summary copy per
// broadcast or reply (never one per recipient) so the church phone is not flooded.
// A copy failing must never affect the real send, so errors are swallowed.
function sendActivityCopy($db, $settings, $summaryText, $emailSubject = null, $emailHtml = null) {
    if (empty($settings['msg_copy_enabled']) || $settings['msg_copy_enabled'] === '0') return;
    try {
        $copyPhone = trim($settings['msg_copy_phone'] ?? '');
        // Twilio refuses to text a number from itself (error 21266), so if the
        // copy number IS the church text number just skip the text copy quietly.
        $fromNum = trim((string)($settings['msg_twilio_number'] ?? ''));
        if ($copyPhone !== '' && $fromNum !== '' && formatPhone($copyPhone) === formatPhone($fromNum)) $copyPhone = '';
        if ($copyPhone !== '' && !empty($settings['msg_twilio_sid'])) {
            sendSMS($copyPhone, $summaryText, $settings['msg_twilio_sid'], $settings['msg_twilio_token'], $settings['msg_twilio_number']);
        }
        $copyEmail = trim($settings['msg_copy_email'] ?? '');
        if ($copyEmail !== '') {
            deliverEmail(
                $settings, $copyEmail, 'Church Admin',
                $emailSubject ?: 'Copy of a church message that was just sent',
                $emailHtml ?: ('<p>' . nl2br(htmlspecialchars($summaryText)) . '</p>')
            );
        }
    } catch (Exception $e) { /* monitoring copy is best-effort only */ }
}

// Record an entry in the shared activity log (the `messages` table) so every
// message any authorised user sends - broadcast OR one-to-one reply - shows up
// under Sent Messages with the sender's name.
function logActivityMessage($db, $userId, $type, $subject, $body, $recipients = 1) {
    try {
        $db->prepare("
            INSERT INTO messages
                (subject, body, message_type, send_type, status, recipient_type,
                 total_recipients, sent_count, failed_count, sent_at, created_by)
            VALUES (?, ?, ?, 'now', 'sent', 'individual', ?, ?, 0, NOW(), ?)
        ")->execute([$subject, $body, $type, $recipients, $recipients, $userId]);
    } catch (Exception $e) { /* activity logging must never break sending */ }
}

/**
 * Send everything still pending on one message, and report what happened.
 *
 * This is the ONLY delivery path. Sending straight away, pressing Send Now on a
 * queued message and the scheduler cron all come through here, so a text that
 * goes out at 6am by the clock behaves exactly like one sent by hand - same
 * consent rules, same error wording, same Inbox logging, same monitoring copy.
 *
 * Everything it needs is read off the message row rather than passed in, because
 * the cron has no request to read it from. $mergeExtra (a gift amount, a pledge
 * balance) is the one exception: an immediate send has it in hand, a scheduled
 * send has to get it back off messages.merge_data where queueing put it.
 */
function dispatchMessage(PDO $db, int $messageId, array $mergeExtra = [], ?int $actorUserId = null, ?string $actorName = null): array {
    $blank = ['sent' => 0, 'failed' => 0, 'email_problems' => [], 'sms_problems' => []];

    $row = $db->prepare("SELECT * FROM messages WHERE id = ?");
    $row->execute([$messageId]);
    $message = $row->fetch();
    if (!$message) return $blank + ['error' => 'Message not found'];

    $body           = (string)$message['body'];
    $subject        = (string)$message['subject'];
    $messageType    = (string)$message['message_type'];
    $attachmentPath = $message['attachment_path'] ?: null;

    if (!$mergeExtra && !empty($message['merge_data'])) {
        $stored = json_decode($message['merge_data'], true);
        if (is_array($stored)) $mergeExtra = $stored;
    }

    $settings = getMessagingSettings($db);
    $sentCount = 0;
    $failedCount = 0;

    $pendingRecps = $db->prepare("SELECT * FROM message_recipients WHERE message_id = ? AND status = 'pending'");
    $pendingRecps->execute([$messageId]);

    $emailErrors = [];
    $smsErrors = [];
    $churchName = trim((string)($settings['msg_from_name'] ?? '')) ?: 'Hallelujah In The City';
    foreach ($pendingRecps->fetchAll() as $recp) {
        $success = false;
        // This person's own copy. With no placeholders in the wording these come
        // back byte-for-byte identical to what was typed.
        $vars = mergeVarsForRecipient($recp, $mergeExtra, $churchName);
        $thisBody = applyMergeFields($body, $vars);
        $thisSubject = applyMergeFields($subject, $vars);
        if ($recp['channel'] === 'email') {
            // Ask for the details, not just true/false. An email that fails used to
            // be recorded as a bare "failed" with no reason, so a provider refusing
            // every message looked exactly like nothing happening at all.
            $mailResult = deliverEmail(
                $settings, $recp['email'], $recp['name'],
                $thisSubject, $thisBody, $attachmentPath, true
            );
            $success = $mailResult['success'];
            if (!$success) {
                $errMsg = $mailResult['error'] ?: 'Email was not accepted by the provider.';
                $db->prepare("UPDATE message_recipients SET error_message = ? WHERE id = ?")->execute([$errMsg, $recp['id']]);
                $emailErrors[$errMsg] = ($emailErrors[$errMsg] ?? 0) + 1;
            }
        } elseif ($recp['channel'] === 'sms' && !empty($settings['msg_twilio_sid'])) {
            $smsBody = strip_tags($thisBody);
            if (strlen($smsBody) > 1600) $smsBody = substr($smsBody, 0, 1597) . '...';
            $mediaUrl = null;
            if ($attachmentPath && file_exists($attachmentPath)) {
                $mediaUrl = 'https://hallelujahinthecity.org/system/api/uploads/' . basename($attachmentPath);
            }
            $smsResult = sendSMS(
                $recp['phone'], $smsBody,
                $settings['msg_twilio_sid'],
                $settings['msg_twilio_token'],
                $settings['msg_twilio_number'],
                $mediaUrl, true
            );
            $success = $smsResult['success'];
            if (!$success) {
                $errMsg = explainSmsError($smsResult['response'], $smsResult['curl_error'], (string)$settings['msg_twilio_number']);
                $db->prepare("UPDATE message_recipients SET error_message = ? WHERE id = ?")->execute([$errMsg, $recp['id']]);
                $smsErrors[$errMsg] = ($smsErrors[$errMsg] ?? 0) + 1;
            } else {
                // Log the outgoing text so the Inbox thread has full context
                $okBody = json_decode($smsResult['response'], true);
                logSmsConversation($db, $recp['member_id'] ? (int)$recp['member_id'] : null, formatPhone($recp['phone']), 'out', $smsBody, $okBody['sid'] ?? null, $actorUserId, true);
            }
        } elseif ($recp['channel'] === 'sms') {
            $notSetUp = 'Texting is not set up - add the Twilio details in Settings > Messaging.';
            $db->prepare("UPDATE message_recipients SET error_message = ? WHERE id = ?")
               ->execute([$notSetUp, $recp['id']]);
            $smsErrors[$notSetUp] = ($smsErrors[$notSetUp] ?? 0) + 1;
        }

        $newStatus = $success ? 'sent' : 'failed';
        $db->prepare("UPDATE message_recipients SET status = ?, sent_at = ? WHERE id = ?")->execute([$newStatus, utcNow(), $recp['id']]);
        if ($success) $sentCount++; else $failedCount++;
    }

    $db->prepare("UPDATE messages SET status = 'sent', sent_count = ?, failed_count = ?, sent_at = ? WHERE id = ?")
        ->execute([$sentCount, $failedCount, utcNow(), $messageId]);

    // Optional monitoring copy to the church/admin - one summary, not one per person.
    if ($sentCount > 0) {
        if ($actorName === null) {
            // The cron has nobody logged in, so name whoever scheduled it.
            try {
                $who = $db->prepare("SELECT name FROM users WHERE id = ?");
                $who->execute([(int)$message['created_by']]);
                $actorName = $who->fetchColumn() ?: null;
            } catch (Exception $e) { /* a missing name must never stop a send */ }
        }
        $sender = $actorName ?: 'A church user';
        $preview = trim(strip_tags($body));
        if (strlen($preview) > 140) $preview = substr($preview, 0, 137) . '...';
        // The copy shows the wording as typed. Say so when the placeholders were
        // filled in differently for each person, otherwise the {first name} in
        // here looks like a fault.
        if ($preview !== '' && strpos($preview, '{') !== false) {
            $preview .= ' (each person got their own name and figures)';
        }
        $label = $messageType === 'sms' ? 'text' : ($messageType === 'both' ? 'email + text' : 'email');
        sendActivityCopy($db, $settings,
            "[HITC] $sender sent a $label to $sentCount " . ($sentCount === 1 ? 'person' : 'people') . ": $preview",
            'Copy: church ' . $label . ' sent to ' . $sentCount . ' ' . ($sentCount === 1 ? 'person' : 'people'),
            '<p><strong>' . htmlspecialchars($sender) . '</strong> sent a ' . $label . ' to <strong>' . $sentCount . '</strong> ' . ($sentCount === 1 ? 'person' : 'people') . ($subject ? ' &mdash; ' . htmlspecialchars($subject) : '') . ':</p><blockquote>' . nl2br(htmlspecialchars($preview)) . '</blockquote>'
        );
    }

    // The single most useful thing to hand back: WHY things failed. Grouped,
    // because when a provider is refusing it is the same reason for every single
    // person and one line says it better than fifty.
    arsort($emailErrors);
    $emailProblems = [];
    foreach ($emailErrors as $why => $howMany) {
        $emailProblems[] = ['count' => $howMany, 'reason' => $why];
    }
    arsort($smsErrors);
    $smsProblems = [];
    foreach ($smsErrors as $why => $howMany) {
        $smsProblems[] = ['count' => $howMany, 'reason' => $why];
    }

    return [
        'sent' => $sentCount,
        'failed' => $failedCount,
        'email_problems' => array_slice($emailProblems, 0, 5),
        'sms_problems' => array_slice($smsProblems, 0, 5),
    ];
}
