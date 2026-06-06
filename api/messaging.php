<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

// SendGrid email sending
function sendEmail($to, $toName, $from, $fromName, $subject, $htmlBody, $apiKey, $attachmentPath = null) {
    $data = [
        'personalizations' => [['to' => [['email' => $to, 'name' => $toName]]]],
        'from' => ['email' => $from, 'name' => $fromName],
        'subject' => $subject,
        'content' => [['type' => 'text/html', 'value' => $htmlBody]],
    ];
    if ($attachmentPath && file_exists($attachmentPath)) {
        $fileData = base64_encode(file_get_contents($attachmentPath));
        $fileName = basename($attachmentPath);
        $mime = mime_content_type($attachmentPath) ?: 'application/octet-stream';
        $data['attachments'] = [['content' => $fileData, 'filename' => $fileName, 'type' => $mime]];
    }
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
    curl_close($ch);
    return $httpCode >= 200 && $httpCode < 300;
}

// Twilio SMS sending
function sendSMS($to, $body, $accountSid, $authToken, $fromNumber) {
    $url = "https://api.twilio.com/2010-04-01/Accounts/$accountSid/Messages.json";
    $data = ['To' => $to, 'From' => $fromNumber, 'Body' => $body];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($data),
        CURLOPT_USERPWD => "$accountSid:$authToken",
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $httpCode >= 200 && $httpCode < 300;
}

// Get messaging settings
function getMessagingSettings($db) {
    $settings = [];
    try {
        $rows = $db->query("SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'msg_%'")->fetchAll();
        foreach ($rows as $r) $settings[$r['setting_key']] = $r['setting_value'];
    } catch (Exception $e) {}
    return $settings;
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

        // Get messaging config status
        if ($action === 'config') {
            $settings = getMessagingSettings($db);
            jsonResponse([
                'email_configured' => !empty($settings['msg_sendgrid_key']),
                'sms_configured' => !empty($settings['msg_twilio_sid']),
                'from_email' => $settings['msg_from_email'] ?? '',
                'from_name' => $settings['msg_from_name'] ?? 'Hallelujah In The City',
            ]);
        }

        break;

    case 'POST':
        // Save messaging configuration
        if ($action === 'config') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $keys = ['msg_sendgrid_key', 'msg_from_email', 'msg_from_name', 'msg_twilio_sid', 'msg_twilio_token', 'msg_twilio_number'];
            foreach ($keys as $key) {
                if (isset($data[$key])) {
                    $db->prepare("INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")
                        ->execute([$key, $data[$key]]);
                }
            }
            jsonResponse(['message' => 'Configuration saved']);
        }

        // Create and send message
        if ($action === 'send') {
            $data = getRequestBody();
            if (empty($data['body'])) jsonResponse(['error' => 'Message body required'], 400);

            $messageType = $data['message_type'] ?? 'email';
            $sendType = $data['send_type'] ?? 'now';
            $subject = $data['subject'] ?? '';
            $body = $data['body'];
            $recipientType = $data['recipient_type'] ?? 'individual';
            $recipientIds = $data['recipient_ids'] ?? [];
            $recipientFilter = $data['recipient_filter'] ?? null;

            // Handle file attachment
            $attachmentPath = null;
            if (!empty($data['attachment_name'])) {
                $attachmentPath = __DIR__ . '/uploads/' . $data['attachment_name'];
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
                $stmt = $db->prepare("SELECT id, first_name, last_name, email, phone FROM members WHERE id IN ($placeholders)");
                $stmt->execute($recipientIds);
                $recipients = $stmt->fetchAll();
            } elseif ($recipientType === 'group' && !empty($data['group_name'])) {
                $stmt = $db->prepare("SELECT id, first_name, last_name, email, phone FROM members WHERE FIND_IN_SET(?, REPLACE(family_group, ', ', ',')) AND status = 'active'");
                $stmt->execute([$data['group_name']]);
                $recipients = $stmt->fetchAll();
            } elseif ($recipientType === 'person_type' && !empty($data['person_type'])) {
                $stmt = $db->prepare("SELECT id, first_name, last_name, email, phone FROM members WHERE person_type = ? AND status = 'active'");
                $stmt->execute([$data['person_type']]);
                $recipients = $stmt->fetchAll();
            } elseif ($recipientType === 'all') {
                $recipients = $db->query("SELECT id, first_name, last_name, email, phone FROM members WHERE status = 'active'")->fetchAll();
            }

            // Insert recipients
            $recpStmt = $db->prepare("INSERT INTO message_recipients (message_id, member_id, email, phone, name, channel) VALUES (?, ?, ?, ?, ?, ?)");
            foreach ($recipients as $r) {
                $name = trim($r['first_name'] . ' ' . $r['last_name']);
                if ($messageType === 'email' || $messageType === 'both') {
                    if ($r['email']) $recpStmt->execute([$messageId, $r['id'], $r['email'], null, $name, 'email']);
                }
                if ($messageType === 'sms' || $messageType === 'both') {
                    if ($r['phone']) $recpStmt->execute([$messageId, $r['id'], null, $r['phone'], $name, 'sms']);
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
                        $success = sendSMS(
                            $recp['phone'], $smsBody,
                            $settings['msg_twilio_sid'],
                            $settings['msg_twilio_token'],
                            $settings['msg_twilio_number']
                        );
                    }

                    $newStatus = $success ? 'sent' : 'failed';
                    $db->prepare("UPDATE message_recipients SET status = ?, sent_at = NOW() WHERE id = ?")->execute([$newStatus, $recp['id']]);
                    if ($success) $sentCount++; else $failedCount++;
                }

                $db->prepare("UPDATE messages SET status = 'sent', sent_count = ?, failed_count = ?, sent_at = NOW() WHERE id = ?")
                    ->execute([$sentCount, $failedCount, $messageId]);

                jsonResponse(['message' => "Sent to $sentCount recipients" . ($failedCount > 0 ? " ($failedCount failed)" : ''), 'id' => $messageId, 'sent' => $sentCount, 'failed' => $failedCount], 201);
            } else {
                jsonResponse(['message' => 'Message scheduled', 'id' => $messageId], 201);
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

            $success = sendEmail(
                $testEmail, 'Test',
                $settings['msg_from_email'] ?? 'noreply@hallelujahinthecity.org',
                $settings['msg_from_name'] ?? 'Hallelujah In The City',
                'Test Email from Church Management',
                '<h2>Test Email</h2><p>This is a test email from your Church Management System. If you received this, email is configured correctly!</p>',
                $settings['msg_sendgrid_key']
            );

            jsonResponse(['success' => $success, 'message' => $success ? 'Test email sent!' : 'Failed to send test email']);
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
