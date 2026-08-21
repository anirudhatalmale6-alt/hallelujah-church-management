<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

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

// Twilio SMS/MMS sending
function sendSMS($to, $body, $accountSid, $authToken, $fromNumber, $mediaUrl = null, $returnDetails = false) {
    $to = formatPhone($to);
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

// Send a monitoring copy of an outgoing message to the church / admin, when the
// pastor has switched it on in Settings. Deliberately ONE summary copy per
// broadcast or reply (never one per recipient) so the church phone is not flooded.
// A copy failing must never affect the real send, so errors are swallowed.
function sendActivityCopy($db, $settings, $summaryText, $emailSubject = null, $emailHtml = null) {
    if (empty($settings['msg_copy_enabled']) || $settings['msg_copy_enabled'] === '0') return;
    try {
        $copyPhone = trim($settings['msg_copy_phone'] ?? '');
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

switch ($method) {
    case 'GET':
        // List messages/broadcasts
        if ($action === '' || $action === 'list') {
            $status = $_GET['status'] ?? '';
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = 25;
            $offset = ($page - 1) * $limit;

            $where = [];
            $params = [];
            if ($status) { $where[] = 'm.status = ?'; $params[] = $status; }
            // Drafts are unfinished, not history - they live on their own tab and
            // must never pad out Sent Messages.
            else { $where[] = "m.status <> 'draft'"; }
            $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            $total = (int)$db->prepare("SELECT COUNT(*) FROM messages m $whereClause")->execute($params) ?
                $db->query("SELECT FOUND_ROWS()")->fetchColumn() : 0;
            $stmt = $db->prepare("SELECT SQL_CALC_FOUND_ROWS m.*, u.name as created_by_name FROM messages m LEFT JOIN users u ON u.id = m.created_by $whereClause ORDER BY m.created_at DESC LIMIT $limit OFFSET $offset");
            $stmt->execute($params);
            $messages = $stmt->fetchAll();
            $total = (int)$db->query("SELECT FOUND_ROWS()")->fetchColumn();

            jsonResponse(['messages' => $messages, 'total' => $total, 'page' => $page, 'pages' => max(1, ceil($total / $limit))]);
        }

        // Unfinished messages, newest first. Everyone who may send can see the
        // team's drafts - the church writes these together.
        if ($action === 'drafts') {
            $stmt = $db->query("
                SELECT m.id, m.subject, m.body, m.message_type, m.recipient_type,
                       m.attachment_path, m.created_at, m.sent_at AS updated_at,
                       u.name AS created_by_name
                FROM messages m
                LEFT JOIN users u ON u.id = m.created_by
                WHERE m.status = 'draft'
                ORDER BY COALESCE(m.sent_at, m.created_at) DESC
                LIMIT 100
            ");
            $drafts = [];
            foreach ($stmt->fetchAll() as $d) {
                $plain = trim(strip_tags(str_ireplace(['<br>', '<br/>', '<br />'], "\n", (string)$d['body'])));
                $d['preview'] = mb_substr($plain, 0, 160);
                $d['attachment_count'] = $d['attachment_path'] ? count(array_filter(explode(',', $d['attachment_path']))) : 0;
                unset($d['body'], $d['attachment_path']);
                $drafts[] = $d;
            }
            jsonResponse(['drafts' => $drafts]);
        }

        // One draft, with everything needed to put the Compose form back the way
        // it was left - including who it was going to.
        if ($action === 'draft') {
            if (!$id) jsonResponse(['error' => 'ID required'], 400);
            $stmt = $db->prepare("SELECT * FROM messages WHERE id = ? AND status = 'draft'");
            $stmt->execute([$id]);
            $draft = $stmt->fetch();
            if (!$draft) jsonResponse(['error' => 'Draft not found'], 404);

            $draft['recipients_saved'] = $draft['recipient_filter'] ? json_decode($draft['recipient_filter'], true) : null;
            $draft['attachment_names'] = array_values(array_filter(array_map(
                fn($p) => basename(trim($p)),
                explode(',', (string)$draft['attachment_path'])
            )));
            jsonResponse(['draft' => $draft]);
        }

        // Get single message with recipients
        if ($action === 'get') {
            if (!$id) jsonResponse(['error' => 'ID required'], 400);
            $msg = $db->prepare("SELECT m.*, u.name as created_by_name FROM messages m LEFT JOIN users u ON u.id = m.created_by WHERE m.id = ?");
            $msg->execute([$id]);
            $message = $msg->fetch();
            if (!$message) jsonResponse(['error' => 'Not found'], 404);

            $recipients = $db->prepare("SELECT * FROM message_recipients WHERE message_id = ? ORDER BY name ASC");
            $recipients->execute([$id]);

            jsonResponse(['message' => $message, 'recipients' => $recipients->fetchAll()]);
        }

        // How many people can we legally text? Drives the warning on the
        // Communication page so a send never silently reaches fewer people
        // than expected.
        if ($action === 'consent_stats') {
            $row = $db->query("
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN phone IS NOT NULL AND phone <> '' THEN 1 ELSE 0 END) AS with_phone,
                    SUM(CASE WHEN phone IS NOT NULL AND phone <> '' AND sms_consent = 1 THEN 1 ELSE 0 END) AS consented,
                    SUM(CASE WHEN sms_opted_out_at IS NOT NULL THEN 1 ELSE 0 END) AS opted_out
                FROM members
                WHERE status = 'active'
            ")->fetch();

            $withPhone = (int)($row['with_phone'] ?? 0);
            $consented = (int)($row['consented'] ?? 0);

            jsonResponse([
                'total'         => (int)($row['total'] ?? 0),
                'with_phone'    => $withPhone,
                'consented'     => $consented,
                'not_consented' => max(0, $withPhone - $consented),
                'opted_out'     => (int)($row['opted_out'] ?? 0),
                'optin_url'     => 'https://www.hallelujahinthecity.org/sms-optin.htm',
            ]);
        }

        // Get messaging config status
        if ($action === 'config') {
            $settings = getMessagingSettings($db);
            $provider = strtolower(trim($settings['msg_email_provider'] ?? '')) ?: 'sendgrid';
            $emailReady = $provider === 'brevo' ? !empty($settings['msg_brevo_key'])
                        : ($provider === 'smtp' ? !empty($settings['msg_smtp_host'])
                        : !empty($settings['msg_sendgrid_key']));
            jsonResponse([
                'email_configured' => $emailReady,
                'sms_configured' => !empty($settings['msg_twilio_sid']),
                // Which service the emails go out through. Keys themselves are never
                // sent back to the browser - only whether one is on file.
                'email_provider' => $provider,
                'sendgrid_saved' => !empty($settings['msg_sendgrid_key']),
                'brevo_saved' => !empty($settings['msg_brevo_key']),
                'smtp_host' => $settings['msg_smtp_host'] ?? '',
                'smtp_port' => $settings['msg_smtp_port'] ?? '587',
                'smtp_user' => $settings['msg_smtp_user'] ?? '',
                'smtp_secure' => $settings['msg_smtp_secure'] ?? 'tls',
                'smtp_pass_saved' => !empty($settings['msg_smtp_pass']),
                'from_email' => $settings['msg_from_email'] ?? '',
                'from_name' => $settings['msg_from_name'] ?? 'Hallelujah In The City',
                // Monitoring copy: send a copy of every outgoing message to the church/admin.
                'copy_enabled' => !empty($settings['msg_copy_enabled']) && $settings['msg_copy_enabled'] !== '0',
                'copy_phone' => $settings['msg_copy_phone'] ?? '',
                'copy_email' => $settings['msg_copy_email'] ?? '',
            ]);
        }

        // Two-way texting: list of conversations (one row per phone), newest first
        if ($action === 'inbox') {
            $rows = $db->query("
                SELECT c.phone,
                       MAX(c.member_id) AS member_id,
                       MAX(c.created_at) AS last_at,
                       MAX(s.status) AS state,
                       SUM(CASE WHEN c.direction = 'in' AND c.read_at IS NULL THEN 1 ELSE 0 END) AS unread,
                       SUBSTRING_INDEX(GROUP_CONCAT(c.body ORDER BY c.created_at DESC, c.id DESC SEPARATOR '\\n\\n<<>>\\n\\n'), '\\n\\n<<>>\\n\\n', 1) AS last_body,
                       SUBSTRING_INDEX(GROUP_CONCAT(c.direction ORDER BY c.created_at DESC, c.id DESC), ',', 1) AS last_dir
                FROM sms_conversations c
                LEFT JOIN sms_conversation_state s ON s.phone = c.phone
                GROUP BY c.phone
                HAVING SUM(CASE WHEN c.direction = 'in' THEN 1 ELSE 0 END) > 0
                ORDER BY last_at DESC
                LIMIT 300
            ")->fetchAll();

            // Attach the person's name/photo where we know them
            $names = [];
            $ids = array_values(array_filter(array_map(fn($r) => $r['member_id'] ? (int)$r['member_id'] : null, $rows)));
            if ($ids) {
                $in = implode(',', array_fill(0, count($ids), '?'));
                $ms = $db->prepare("SELECT id, first_name, last_name, photo_url FROM members WHERE id IN ($in)");
                $ms->execute($ids);
                foreach ($ms->fetchAll() as $m) $names[(int)$m['id']] = $m;
            }
            foreach ($rows as &$r) {
                $r['unread'] = (int)$r['unread'];
                $r['member_id'] = $r['member_id'] ? (int)$r['member_id'] : null;
                $m = $r['member_id'] ? ($names[$r['member_id']] ?? null) : null;
                $r['name'] = $m ? trim($m['first_name'] . ' ' . $m['last_name']) : '';
                $r['photo_url'] = $m['photo_url'] ?? null;
                // At-a-glance status for the pastor:
                //  new      - an unread reply is waiting
                //  awaiting - they texted last, you have not replied yet
                //  replied  - you sent the last message
                //  done     - you marked this thread handled
                $state = $r['state'] ?? null;
                if ($r['unread'] > 0)            $r['status'] = 'new';
                elseif ($state === 'done')       $r['status'] = 'done';
                elseif ($r['last_dir'] === 'in') $r['status'] = 'awaiting';
                else                             $r['status'] = 'replied';
                unset($r['state']);
            }
            unset($r);
            jsonResponse(['conversations' => $rows]);
        }

        // Total unread inbound texts, for the tab badge
        if ($action === 'inbox_unread') {
            $n = (int)$db->query("SELECT COUNT(*) FROM sms_conversations WHERE direction = 'in' AND read_at IS NULL")->fetchColumn();
            jsonResponse(['unread' => $n]);
        }

        // All messages in one conversation (and mark its incoming ones read)
        if ($action === 'thread') {
            $phone = $_GET['phone'] ?? '';
            if ($phone === '' && $id) {
                $st = $db->prepare("SELECT phone FROM members WHERE id = ?");
                $st->execute([$id]);
                $phone = (string)$st->fetchColumn();
            }
            if ($phone === '') jsonResponse(['error' => 'Phone required'], 400);

            $st = $db->prepare("SELECT c.*, u.name AS sent_by_name
                                FROM sms_conversations c
                                LEFT JOIN users u ON u.id = c.created_by
                                WHERE c.phone = ?
                                ORDER BY c.created_at ASC, c.id ASC");
            $st->execute([$phone]);
            $msgs = $st->fetchAll();

            $db->prepare("UPDATE sms_conversations SET read_at = NOW() WHERE phone = ? AND direction = 'in' AND read_at IS NULL")->execute([$phone]);

            $memberId = findMemberByPhone($db, $phone);
            $member = null;
            if ($memberId) {
                $ms = $db->prepare("SELECT id, first_name, last_name, photo_url, sms_consent, sms_opted_out_at FROM members WHERE id = ?");
                $ms->execute([$memberId]);
                $member = $ms->fetch();
            }
            $ss = $db->prepare("SELECT status FROM sms_conversation_state WHERE phone = ?");
            $ss->execute([$phone]);
            $state = $ss->fetchColumn() ?: 'open';
            jsonResponse(['phone' => $phone, 'messages' => $msgs, 'member' => $member, 'state' => $state]);
        }

        break;

    case 'POST':
        // Save messaging configuration
        if ($action === 'config') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            // Secrets are only written when a value is actually supplied, so saving
            // the form with the key box left blank keeps the key already on file.
            $keys = ['msg_sendgrid_key', 'msg_brevo_key', 'msg_smtp_pass',
                     'msg_from_email', 'msg_from_name',
                     'msg_twilio_sid', 'msg_twilio_token', 'msg_twilio_number'];
            $saved = [];
            foreach ($keys as $key) {
                if (isset($data[$key]) && $data[$key] !== '') {
                    try {
                        $db->prepare("DELETE FROM settings WHERE `key` = ?")->execute([$key]);
                        $db->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?)")->execute([$key, $data[$key]]);
                        $saved[] = $key;
                    } catch (Exception $e) {
                        jsonResponse(['error' => "Failed to save $key: " . $e->getMessage()], 500);
                    }
                }
            }
            // Monitoring-copy settings are saved even when blank, so the pastor can
            // turn the copy off or clear the phone/email. copy_enabled is stored as '1'/'0'.
            // These are settings, not secrets, so a blank value has to be able to
            // clear them - and the provider choice must save even when nothing else did.
            $plainKeys = ['msg_email_provider', 'msg_smtp_host', 'msg_smtp_port', 'msg_smtp_user', 'msg_smtp_secure'];
            foreach ($plainKeys as $key) {
                if (!array_key_exists($key, $data)) continue;
                $val = trim((string)$data[$key]);
                if ($key === 'msg_email_provider' && !in_array($val, ['sendgrid', 'brevo', 'smtp'], true)) continue;
                try {
                    $db->prepare("DELETE FROM settings WHERE `key` = ?")->execute([$key]);
                    if ($val !== '') $db->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?)")->execute([$key, $val]);
                    $saved[] = $key;
                } catch (Exception $e) {
                    jsonResponse(['error' => "Failed to save $key: " . $e->getMessage()], 500);
                }
            }

            $copyKeys = ['msg_copy_enabled', 'msg_copy_phone', 'msg_copy_email'];
            foreach ($copyKeys as $key) {
                if (!array_key_exists($key, $data)) continue;
                $val = $key === 'msg_copy_enabled' ? (!empty($data[$key]) ? '1' : '0') : trim((string)$data[$key]);
                try {
                    $db->prepare("DELETE FROM settings WHERE `key` = ?")->execute([$key]);
                    if ($val !== '') $db->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?)")->execute([$key, $val]);
                    $saved[] = $key;
                } catch (Exception $e) {
                    jsonResponse(['error' => "Failed to save $key: " . $e->getMessage()], 500);
                }
            }
            jsonResponse(['message' => 'Configuration saved (' . count($saved) . ' settings)', 'saved' => $saved]);
        }

        // Reply to one person in the Inbox (a direct 1-to-1 text). No consent
        // gate here: they texted us first, so answering is allowed.
        if ($action === 'reply') {
            requireSectionEdit($currentUser, 'communication', 'send');
            $data = getRequestBody();
            $body = trim($data['body'] ?? '');
            $phone = trim($data['phone'] ?? '');
            $memberId = !empty($data['member_id']) ? (int)$data['member_id'] : null;
            if ($body === '') jsonResponse(['error' => 'Message body required'], 400);
            if ($phone === '' && $memberId) {
                $st = $db->prepare("SELECT phone FROM members WHERE id = ?");
                $st->execute([$memberId]);
                $phone = (string)$st->fetchColumn();
            }
            if ($phone === '') jsonResponse(['error' => 'No phone number for this person'], 400);

            $settings = getMessagingSettings($db);
            if (empty($settings['msg_twilio_sid'])) jsonResponse(['error' => 'SMS is not set up yet (add your Twilio details in Settings).'], 400);

            if (!$memberId) $memberId = findMemberByPhone($db, $phone);
            $res = sendSMS($phone, $body, $settings['msg_twilio_sid'], $settings['msg_twilio_token'], $settings['msg_twilio_number'], null, true);
            if (!$res['success']) {
                $err = json_decode($res['response'], true);
                jsonResponse(['error' => 'Text failed: ' . ($err['message'] ?? ($res['curl_error'] ?: 'Unknown error'))], 502);
            }
            $ok = json_decode($res['response'], true);
            logSmsConversation($db, $memberId, formatPhone($phone), 'out', $body, $ok['sid'] ?? null, (int)$currentUser['user_id'], true);

            // Who did we text? (for the activity log + monitoring copy)
            $recipName = '';
            if ($memberId) {
                $nq = $db->prepare("SELECT TRIM(CONCAT(first_name, ' ', last_name)) FROM members WHERE id = ?");
                $nq->execute([$memberId]);
                $recipName = (string)$nq->fetchColumn();
            }
            $who = $recipName !== '' ? $recipName : formatPhone($phone);
            $sender = $currentUser['name'] ?? 'A church user';

            // Every reply is logged in the shared activity log with the sender's name.
            logActivityMessage($db, (int)$currentUser['user_id'], 'sms', 'Text reply to ' . $who, $body, 1);
            // Optional monitoring copy to the church/admin.
            sendActivityCopy($db, $settings,
                "[HITC] $sender replied by text to $who: $body",
                'Copy: text reply to ' . $who,
                '<p><strong>' . htmlspecialchars($sender) . '</strong> replied by text to <strong>' . htmlspecialchars($who) . '</strong>:</p><blockquote>' . nl2br(htmlspecialchars($body)) . '</blockquote>'
            );
            jsonResponse(['message' => 'Sent']);
        }

        // Mark a conversation handled ("done") or re-open it
        if ($action === 'set_status') {
            $data = getRequestBody();
            $phone = trim($data['phone'] ?? '');
            $status = ($data['status'] ?? '') === 'done' ? 'done' : 'open';
            if ($phone === '') jsonResponse(['error' => 'Phone required'], 400);
            $db->prepare("INSERT INTO sms_conversation_state (phone, status, updated_by, updated_at) VALUES (?, ?, ?, NOW())
                          ON DUPLICATE KEY UPDATE status = VALUES(status), updated_by = VALUES(updated_by), updated_at = NOW()")
               ->execute([$phone, $status, (int)$currentUser['user_id']]);
            jsonResponse(['message' => 'Status updated', 'status' => $status]);
        }

        // Create and send message
        // Park an unfinished message. Saving the same draft again updates it in
        // place (pass its id) instead of piling up copies of the same message.
        if ($action === 'save_draft') {
            requireSectionEdit($currentUser, 'communication', 'send');
            $data = getRequestBody();

            $subject = (string)($data['subject'] ?? '');
            $body = (string)($data['body'] ?? '');
            if (trim($subject) === '' && trim(strip_tags($body)) === '') {
                jsonResponse(['error' => 'Nothing to save yet - write a subject or a message first.'], 400);
            }

            // The whole recipient choice is kept as-is so reopening the draft puts
            // the exact same people back in the box.
            $saved = [
                'recipient_ids'    => array_values(array_map('intval', (array)($data['recipient_ids'] ?? []))),
                'direct_contacts'  => array_values((array)($data['direct_contacts'] ?? [])),
                'group_name'       => $data['group_name'] ?? null,
                'person_type'      => $data['person_type'] ?? null,
                'attachment_names' => array_values((array)($data['attachment_names'] ?? [])),
                'send_type'        => $data['send_type'] ?? 'now',
                'scheduled_at'     => $data['scheduled_at'] ?? null,
                'recurring_pattern'=> $data['recurring_pattern'] ?? null,
            ];
            $attachmentPath = $saved['attachment_names']
                ? implode(',', array_map(fn($n) => __DIR__ . '/uploads/' . $n, $saved['attachment_names']))
                : null;

            $draftId = (int)($data['draft_id'] ?? 0);
            if ($draftId) {
                // Make sure we are not overwriting something already sent.
                $own = $db->prepare("SELECT id FROM messages WHERE id = ? AND status = 'draft'");
                $own->execute([$draftId]);
                if (!$own->fetchColumn()) jsonResponse(['error' => 'That draft no longer exists.'], 404);
                $db->prepare("
                    UPDATE messages
                       SET subject = ?, body = ?, message_type = ?, recipient_type = ?,
                           recipient_filter = ?, attachment_path = ?, sent_at = NOW()
                     WHERE id = ? AND status = 'draft'
                ")->execute([
                    $subject, $body,
                    $data['message_type'] ?? 'email',
                    $data['recipient_type'] ?? 'individual',
                    json_encode($saved), $attachmentPath, $draftId,
                ]);
            } else {
                // sent_at doubles as "last touched" for a draft, so the list can be
                // ordered by when it was actually last worked on.
                $db->prepare("
                    INSERT INTO messages
                        (subject, body, message_type, send_type, status, recipient_type,
                         recipient_filter, attachment_path, total_recipients, created_by, sent_at)
                    VALUES (?, ?, ?, 'now', 'draft', ?, ?, ?, 0, ?, NOW())
                ")->execute([
                    $subject, $body,
                    $data['message_type'] ?? 'email',
                    $data['recipient_type'] ?? 'individual',
                    json_encode($saved), $attachmentPath,
                    $currentUser['user_id'],
                ]);
                $draftId = (int)$db->lastInsertId();
            }

            jsonResponse(['message' => 'Draft saved', 'draft_id' => $draftId], 201);
        }

        if ($action === 'send') {
            requireSectionEdit($currentUser, 'communication', 'send');
            $data = getRequestBody();
            if (empty($data['body'])) jsonResponse(['error' => 'Message body required'], 400);

            $messageType = $data['message_type'] ?? 'email';
            $sendType = $data['send_type'] ?? 'now';
            $subject = $data['subject'] ?? '';
            $body = $data['body'];
            $recipientType = $data['recipient_type'] ?? 'individual';
            $recipientIds = $data['recipient_ids'] ?? [];
            $recipientFilter = $data['recipient_filter'] ?? null;

            // Handle file attachments (single or multiple)
            $attachmentPath = null;
            $attachmentPaths = [];
            if (!empty($data['attachment_names']) && is_array($data['attachment_names'])) {
                foreach ($data['attachment_names'] as $aname) {
                    $attachmentPaths[] = __DIR__ . '/uploads/' . $aname;
                }
                $attachmentPath = implode(',', $attachmentPaths);
            } elseif (!empty($data['attachment_name'])) {
                $attachmentPath = __DIR__ . '/uploads/' . $data['attachment_name'];
                $attachmentPaths = [$attachmentPath];
            }

            // Create message record
            $stmt = $db->prepare("
                INSERT INTO messages (subject, body, message_type, send_type, scheduled_at, status, recipient_type, recipient_filter, attachment_path, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $status = ($sendType === 'now') ? 'sending' : 'queued';
            $stmt->execute([
                $subject, $body, $messageType, $sendType,
                $data['scheduled_at'] ?? null,
                $status, $recipientType,
                $recipientFilter ? json_encode($recipientFilter) : null,
                $attachmentPath,
                $currentUser['user_id'],
            ]);
            $messageId = (int)$db->lastInsertId();

            // Sending a draft finishes it - the real message row above replaces it,
            // so the draft must not linger on the Drafts tab.
            if (!empty($data['draft_id'])) {
                try {
                    $db->prepare("DELETE FROM messages WHERE id = ? AND status = 'draft'")
                       ->execute([(int)$data['draft_id']]);
                } catch (Exception $e) { /* a leftover draft must never fail a send */ }
            }

            // Build recipient list
            $recipients = [];
            if ($recipientType === 'individual' && !empty($recipientIds)) {
                $placeholders = implode(',', array_fill(0, count($recipientIds), '?'));
                $stmt = $db->prepare("SELECT id, first_name, last_name, email, phone, sms_consent FROM members WHERE id IN ($placeholders)");
                $stmt->execute($recipientIds);
                $recipients = $stmt->fetchAll();
            } elseif ($recipientType === 'direct') {
                // Direct email/phone entry
                $directContacts = $data['direct_contacts'] ?? [];
                // A hand-typed number still needs consent on file, so match it
                // against People (last 10 digits) and carry that person's flag.
                $consentLookup = $db->prepare("
                    SELECT sms_consent FROM members
                    WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', ''), 10) = ?
                    ORDER BY sms_consent DESC LIMIT 1
                ");
                foreach ($directContacts as $dc) {
                    $dcPhone = $dc['phone'] ?? null;
                    $dcConsent = 0;
                    if ($dcPhone) {
                        $last10 = substr(preg_replace('/\D+/', '', $dcPhone), -10);
                        if (strlen($last10) === 10) {
                            $consentLookup->execute([$last10]);
                            $dcConsent = (int)$consentLookup->fetchColumn();
                        }
                    }
                    $recipients[] = [
                        'id' => null,
                        'first_name' => $dc['name'] ?? 'Unknown',
                        'last_name' => '',
                        'email' => $dc['email'] ?? null,
                        'phone' => $dcPhone,
                        'sms_consent' => $dcConsent,
                    ];
                }
            } elseif ($recipientType === 'group' && !empty($data['group_name'])) {
                // Resolve through member_groups rather than string-matching the
                // cached name list, so a group name can never miss a recipient.
                $stmt = $db->prepare("
                    SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.sms_consent
                    FROM member_groups mg
                    JOIN members m ON m.id = mg.member_id
                    JOIN `groups` g ON g.id = mg.group_id
                    WHERE g.name = ? AND m.status = 'active'
                ");
                $stmt->execute([$data['group_name']]);
                $recipients = $stmt->fetchAll();
            } elseif ($recipientType === 'person_type' && !empty($data['person_type'])) {
                $stmt = $db->prepare("SELECT id, first_name, last_name, email, phone, sms_consent FROM members WHERE person_type = ? AND status = 'active'");
                $stmt->execute([$data['person_type']]);
                $recipients = $stmt->fetchAll();
            } elseif ($recipientType === 'all') {
                $recipients = $db->query("SELECT id, first_name, last_name, email, phone, sms_consent FROM members WHERE status = 'active'")->fetchAll();
            }

            // Insert recipients
            $recpStmt = $db->prepare("INSERT INTO message_recipients (message_id, member_id, email, phone, name, channel) VALUES (?, ?, ?, ?, ?, ?)");
            $smsSkipped = [];
            foreach ($recipients as $r) {
                $name = trim($r['first_name'] . ' ' . $r['last_name']);
                if ($messageType === 'email' || $messageType === 'both') {
                    if ($r['email']) $recpStmt->execute([$messageId, $r['id'], $r['email'], null, $name, 'email']);
                }
                // SMS ONLY to people who gave consent. Texting someone who never
                // opted in is illegal (TCPA) and gets the number blocked by the
                // carriers, so we skip them here rather than trusting the caller.
                if ($messageType === 'sms' || $messageType === 'both') {
                    if ($r['phone'] && !empty($r['sms_consent'])) {
                        $recpStmt->execute([$messageId, $r['id'], null, $r['phone'], $name, 'sms']);
                    } elseif ($r['phone']) {
                        $smsSkipped[] = $name;
                    }
                }
            }

            $totalRecipients = count($recipients);
            $db->prepare("UPDATE messages SET total_recipients = ? WHERE id = ?")->execute([$totalRecipients, $messageId]);

            // Send now
            if ($sendType === 'now') {
                $settings = getMessagingSettings($db);
                $sentCount = 0;
                $failedCount = 0;

                $pendingRecps = $db->prepare("SELECT * FROM message_recipients WHERE message_id = ? AND status = 'pending'");
                $pendingRecps->execute([$messageId]);

                $emailErrors = [];
                foreach ($pendingRecps->fetchAll() as $recp) {
                    $success = false;
                    if ($recp['channel'] === 'email') {
                        // Ask for the details, not just true/false. An email that fails
                        // used to be recorded as a bare "failed" with no reason, so a
                        // provider refusing every message (an expired plan, a bad key)
                        // looked exactly like nothing happening at all.
                        $mailResult = deliverEmail(
                            $settings, $recp['email'], $recp['name'],
                            $subject, $body, $attachmentPath, true
                        );
                        $success = $mailResult['success'];
                        if (!$success) {
                            $errMsg = $mailResult['error'] ?: 'Email was not accepted by the provider.';
                            $db->prepare("UPDATE message_recipients SET error_message = ? WHERE id = ?")->execute([$errMsg, $recp['id']]);
                            $emailErrors[$errMsg] = ($emailErrors[$errMsg] ?? 0) + 1;
                        }
                    } elseif ($recp['channel'] === 'sms' && !empty($settings['msg_twilio_sid'])) {
                        $smsBody = strip_tags($body);
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
                            $errBody = json_decode($smsResult['response'], true);
                            $errMsg = $errBody['message'] ?? ($smsResult['curl_error'] ?: 'Unknown error');
                            $db->prepare("UPDATE message_recipients SET error_message = ? WHERE id = ?")->execute([$errMsg, $recp['id']]);
                        } else {
                            // Log the outgoing text so the Inbox thread has full context
                            $okBody = json_decode($smsResult['response'], true);
                            logSmsConversation($db, $recp['member_id'] ? (int)$recp['member_id'] : null, formatPhone($recp['phone']), 'out', $smsBody, $okBody['sid'] ?? null, (int)$currentUser['user_id'], true);
                        }
                    } elseif ($recp['channel'] === 'sms') {
                        $db->prepare("UPDATE message_recipients SET error_message = ? WHERE id = ?")
                           ->execute(['Texting is not set up - add the Twilio details in Settings > Messaging.', $recp['id']]);
                    }

                    $newStatus = $success ? 'sent' : 'failed';
                    $db->prepare("UPDATE message_recipients SET status = ?, sent_at = NOW() WHERE id = ?")->execute([$newStatus, $recp['id']]);
                    if ($success) $sentCount++; else $failedCount++;
                }

                $db->prepare("UPDATE messages SET status = 'sent', sent_count = ?, failed_count = ?, sent_at = NOW() WHERE id = ?")
                    ->execute([$sentCount, $failedCount, $messageId]);

                // Optional monitoring copy to the church/admin - one summary, not one per person.
                if ($sentCount > 0) {
                    $sender = $currentUser['name'] ?? 'A church user';
                    $preview = trim(strip_tags($body));
                    if (strlen($preview) > 140) $preview = substr($preview, 0, 137) . '...';
                    $label = $messageType === 'sms' ? 'text' : ($messageType === 'both' ? 'email + text' : 'email');
                    sendActivityCopy($db, $settings,
                        "[HITC] $sender sent a $label to $sentCount " . ($sentCount === 1 ? 'person' : 'people') . ": $preview",
                        'Copy: church ' . $label . ' sent to ' . $sentCount . ' ' . ($sentCount === 1 ? 'person' : 'people'),
                        '<p><strong>' . htmlspecialchars($sender) . '</strong> sent a ' . $label . ' to <strong>' . $sentCount . '</strong> ' . ($sentCount === 1 ? 'person' : 'people') . ($subject ? ' &mdash; ' . htmlspecialchars($subject) : '') . ':</p><blockquote>' . nl2br(htmlspecialchars($preview)) . '</blockquote>'
                    );
                }

                $skippedNote = $smsSkipped
                    ? ' - ' . count($smsSkipped) . ' skipped for SMS (no text consent on file)'
                    : '';
                // The single most useful thing to hand back: WHY the emails failed.
                // Grouped, because when a provider is refusing it is the same reason
                // for every single person and one line says it better than fifty.
                arsort($emailErrors);
                $emailProblems = [];
                foreach ($emailErrors as $why => $howMany) {
                    $emailProblems[] = ['count' => $howMany, 'reason' => $why];
                }
                jsonResponse([
                    'message' => "Sent to $sentCount recipients" . ($failedCount > 0 ? " ($failedCount failed)" : '') . $skippedNote,
                    'id' => $messageId,
                    'sent' => $sentCount,
                    'failed' => $failedCount,
                    'email_problems' => array_slice($emailProblems, 0, 5),
                    'sms_skipped' => count($smsSkipped),
                    'sms_skipped_names' => array_slice($smsSkipped, 0, 50),
                ], 201);
            } else {
                jsonResponse([
                    'message' => 'Message scheduled',
                    'id' => $messageId,
                    'sms_skipped' => count($smsSkipped),
                    'sms_skipped_names' => array_slice($smsSkipped, 0, 50),
                ], 201);
            }
        }

        // Upload attachment
        if ($action === 'upload') {
            if (empty($_FILES['file'])) jsonResponse(['error' => 'No file uploaded'], 400);
            $uploadDir = __DIR__ . '/uploads/';
            if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
            $fileName = uniqid() . '_' . basename($_FILES['file']['name']);
            $targetPath = $uploadDir . $fileName;
            if (move_uploaded_file($_FILES['file']['tmp_name'], $targetPath)) {
                jsonResponse(['filename' => $fileName, 'path' => $targetPath]);
            } else {
                jsonResponse(['error' => 'Upload failed'], 500);
            }
        }

        // Test email configuration
        if ($action === 'test_email') {
            $data = getRequestBody();
            $settings = getMessagingSettings($db);
            $testEmail = $data['email'] ?? $currentUser['email'] ?? '';
            if (!$testEmail) jsonResponse(['error' => 'Email address required'], 400);

            $provider = strtolower(trim($settings['msg_email_provider'] ?? '')) ?: 'sendgrid';
            $label = ['sendgrid' => 'SendGrid', 'brevo' => 'Brevo', 'smtp' => 'your own mail server'][$provider] ?? $provider;

            $result = deliverEmail(
                $settings, $testEmail, 'Test',
                'Test Email from Church Management',
                '<h2>Test Email</h2><p>This is a test email from your Church Management System. If you received this, email is configured correctly!</p>',
                null, true
            );

            if ($result['success']) {
                jsonResponse(['success' => true, 'provider' => $provider, 'message' => "Test email sent through $label. Check your inbox."]);
            } else {
                jsonResponse(['success' => false, 'provider' => $provider, 'message' => $result['error'] ?: 'Failed to send.']);
            }
        }

        break;

    case 'DELETE':
        if (!$id) jsonResponse(['error' => 'Message ID required'], 400);

        // A draft is unfinished work, not church history: anyone allowed to write
        // messages may throw one away. Sent messages stay pastor/admin only.
        $isDraft = $db->prepare("SELECT 1 FROM messages WHERE id = ? AND status = 'draft'");
        $isDraft->execute([$id]);
        if ($isDraft->fetchColumn()) {
            requireSectionEdit($currentUser, 'communication', 'send');
            $db->prepare("DELETE FROM messages WHERE id = ? AND status = 'draft'")->execute([$id]);
            jsonResponse(['message' => 'Draft deleted']);
        }

        requireRole($currentUser, ['pastor', 'admin']);
        $db->prepare("DELETE FROM messages WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Message deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
