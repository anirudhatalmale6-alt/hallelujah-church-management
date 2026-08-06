<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

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
        if ($copyEmail !== '' && !empty($settings['msg_sendgrid_key'])) {
            sendEmail(
                $copyEmail, 'Church Admin',
                $settings['msg_from_email'] ?? 'noreply@hallelujahinthecity.org',
                $settings['msg_from_name'] ?? 'Hallelujah In The City',
                $emailSubject ?: 'Copy of a church message that was just sent',
                $emailHtml ?: ('<p>' . nl2br(htmlspecialchars($summaryText)) . '</p>'),
                $settings['msg_sendgrid_key']
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
            $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            $total = (int)$db->prepare("SELECT COUNT(*) FROM messages m $whereClause")->execute($params) ?
                $db->query("SELECT FOUND_ROWS()")->fetchColumn() : 0;
            $stmt = $db->prepare("SELECT SQL_CALC_FOUND_ROWS m.*, u.name as created_by_name FROM messages m LEFT JOIN users u ON u.id = m.created_by $whereClause ORDER BY m.created_at DESC LIMIT $limit OFFSET $offset");
            $stmt->execute($params);
            $messages = $stmt->fetchAll();
            $total = (int)$db->query("SELECT FOUND_ROWS()")->fetchColumn();

            jsonResponse(['messages' => $messages, 'total' => $total, 'page' => $page, 'pages' => max(1, ceil($total / $limit))]);
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
            jsonResponse([
                'email_configured' => !empty($settings['msg_sendgrid_key']),
                'sms_configured' => !empty($settings['msg_twilio_sid']),
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
            $keys = ['msg_sendgrid_key', 'msg_from_email', 'msg_from_name', 'msg_twilio_sid', 'msg_twilio_token', 'msg_twilio_number'];
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

                foreach ($pendingRecps->fetchAll() as $recp) {
                    $success = false;
                    if ($recp['channel'] === 'email' && !empty($settings['msg_sendgrid_key'])) {
                        $success = sendEmail(
                            $recp['email'], $recp['name'],
                            $settings['msg_from_email'] ?? 'noreply@hallelujahinthecity.org',
                            $settings['msg_from_name'] ?? 'Hallelujah In The City',
                            $subject, $body,
                            $settings['msg_sendgrid_key'],
                            $attachmentPath
                        );
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
                jsonResponse([
                    'message' => "Sent to $sentCount recipients" . ($failedCount > 0 ? " ($failedCount failed)" : '') . $skippedNote,
                    'id' => $messageId,
                    'sent' => $sentCount,
                    'failed' => $failedCount,
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
            if (empty($settings['msg_sendgrid_key'])) jsonResponse(['error' => 'SendGrid API key not configured'], 400);
            $testEmail = $data['email'] ?? $currentUser['email'] ?? '';
            if (!$testEmail) jsonResponse(['error' => 'Email address required'], 400);

            $result = sendEmail(
                $testEmail, 'Test',
                $settings['msg_from_email'] ?? 'noreply@hallelujahinthecity.org',
                $settings['msg_from_name'] ?? 'Hallelujah In The City',
                'Test Email from Church Management',
                '<h2>Test Email</h2><p>This is a test email from your Church Management System. If you received this, email is configured correctly!</p>',
                $settings['msg_sendgrid_key'],
                null, true
            );

            if ($result['success']) {
                jsonResponse(['success' => true, 'message' => 'Test email sent! Check your inbox.']);
            } else {
                $errMsg = 'Failed to send.';
                $body = json_decode($result['response'], true);
                if (!empty($body['errors'])) {
                    $errMsg = implode('; ', array_map(fn($e) => $e['message'] ?? '', $body['errors']));
                } elseif ($result['curl_error']) {
                    $errMsg = 'Connection error: ' . $result['curl_error'];
                } else {
                    $errMsg = 'SendGrid returned HTTP ' . $result['http_code'] . '. ' . ($result['response'] ?: 'Check your API key and from email.');
                }
                jsonResponse(['success' => false, 'message' => $errMsg]);
            }
        }

        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) jsonResponse(['error' => 'Message ID required'], 400);
        $db->prepare("DELETE FROM messages WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Message deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
