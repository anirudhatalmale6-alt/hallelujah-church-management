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
            jsonResponse(['message' => 'Configuration saved (' . count($saved) . ' settings)', 'saved' => $saved]);
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
                $stmt = $db->prepare("SELECT id, first_name, last_name, email, phone FROM members WHERE id IN ($placeholders)");
                $stmt->execute($recipientIds);
                $recipients = $stmt->fetchAll();
            } elseif ($recipientType === 'direct') {
                // Direct email/phone entry
                $directContacts = $data['direct_contacts'] ?? [];
                foreach ($directContacts as $dc) {
                    $recipients[] = [
                        'id' => null,
                        'first_name' => $dc['name'] ?? 'Unknown',
                        'last_name' => '',
                        'email' => $dc['email'] ?? null,
                        'phone' => $dc['phone'] ?? null,
                    ];
                }
            } elseif ($recipientType === 'group' && !empty($data['group_name'])) {
                // Resolve through member_groups rather than string-matching the
                // cached name list, so a group name can never miss a recipient.
                $stmt = $db->prepare("
                    SELECT m.id, m.first_name, m.last_name, m.email, m.phone
                    FROM member_groups mg
                    JOIN members m ON m.id = mg.member_id
                    JOIN `groups` g ON g.id = mg.group_id
                    WHERE g.name = ? AND m.status = 'active'
                ");
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
                        }
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
