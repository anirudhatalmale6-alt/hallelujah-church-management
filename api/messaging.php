<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/messaging_core.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

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

        // Everything still waiting to go out. Separate from Sent Messages because
        // these can still be changed - and because a message whose time has come
        // and gone while still sitting here is the one thing nobody must miss.
        if ($action === 'scheduled') {
            $stmt = $db->query("
                SELECT m.id, m.subject, m.body, m.message_type, m.recipient_type,
                       m.scheduled_at, m.total_recipients, m.created_at,
                       u.name AS created_by_name
                FROM messages m
                LEFT JOIN users u ON u.id = m.created_by
                WHERE m.status IN ('queued', 'sending')
                ORDER BY m.scheduled_at ASC
                LIMIT 200
            ");
            // Worked out here, against the stored UTC, before jsonResponse turns
            // these stamps into Philadelphia time on the way out.
            $now = strtotime(utcNow());
            $rows = [];
            foreach ($stmt->fetchAll() as $m) {
                $plain = trim(strip_tags(str_ireplace(['<br>', '<br/>', '<br />'], "\n", (string)$m['body'])));
                $m['preview'] = mb_substr($plain, 0, 160);
                $due = $m['scheduled_at'] ? strtotime($m['scheduled_at']) : null;
                // Overdue means the scheduler should have sent this and has not:
                // either the cron is not running or it held the message back for
                // being too old to send unasked.
                $m['overdue'] = $due !== null && $due < ($now - 120);
                $m['minutes_late'] = $m['overdue'] ? (int)round(($now - $due) / 60) : 0;
                unset($m['body']);
                $rows[] = $m;
            }
            jsonResponse(['scheduled' => $rows]);
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
                // The church's own sending number is not a secret (every member sees
                // it on their phone) and it MUST be visible here - it silently went
                // wrong once and every text failed with no clue where to look.
                'twilio_number' => $settings['msg_twilio_number'] ?? '',
            ]);
        }

        // The saved wording for the one-click thank-you and pledge reminder,
        // with the built-in wording filled in wherever nothing has been saved.
        if ($action === 'templates') {
            jsonResponse([
                'templates' => getMessageTemplates($db),
                'defaults' => defaultMessageTemplates(),
                'fields' => mergeFieldNames(),
            ]);
        }

        // Which numbers are actually on the Twilio account? Powers the picker in
        // Settings so the sending number can be chosen instead of typed.
        if ($action === 'twilio_numbers') {
            $settings = getMessagingSettings($db);
            if (empty($settings['msg_twilio_sid']) || empty($settings['msg_twilio_token'])) {
                jsonResponse(['numbers' => [], 'error' => 'Add your Twilio Account SID and Auth Token first.']);
            }
            jsonResponse(['numbers' => twilioOwnedNumbers($settings['msg_twilio_sid'], $settings['msg_twilio_token'])]);
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

            // Guard the church text number. A number that Twilio does not own
            // is accepted silently and then refuses EVERY text, which looks
            // exactly like the members' numbers being wrong. Check it here, once,
            // instead of finding out after a broadcast has already failed.
            if (isset($data['msg_twilio_number']) && $data['msg_twilio_number'] !== '') {
                $wanted = trim((string)$data['msg_twilio_number']);
                if (strpos($wanted, '+') !== 0) $wanted = formatPhone($wanted);
                $data['msg_twilio_number'] = $wanted;

                $existing = getMessagingSettings($db);
                $sid   = $data['msg_twilio_sid']   ?? ($existing['msg_twilio_sid']   ?? '');
                $token = $data['msg_twilio_token'] ?? ($existing['msg_twilio_token'] ?? '');
                if ($sid !== '' && $token !== '') {
                    $owned = twilioOwnedNumbers($sid, $token);
                    // Only reject when we got a real list back. An outage or a
                    // timeout returns [] and must never lock the pastor out.
                    if ($owned) {
                        $numbers = array_column($owned, 'number');
                        if (!in_array($wanted, $numbers, true)) {
                            $labels = array_map(function ($n) { return $n['label'] . ' (' . $n['number'] . ')'; }, $owned);
                            jsonResponse([
                                'error' => 'That is not a text number on your Twilio account, so no text would go out. '
                                         . 'Your Twilio account has: ' . implode(', ', $labels) . '. '
                                         . 'Please use one of those as the church text number.',
                                'available_numbers' => $owned,
                            ], 400);
                        }
                    }
                }
            }

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

        // Save the thank-you / reminder wording. Unlike the keys above, a blank
        // value here is meaningful: it clears the saved wording and puts the
        // built-in wording back, which is what the Reset button does.
        if ($action === 'templates') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $saved = [];
            foreach (array_keys(defaultMessageTemplates()) as $key) {
                if (!array_key_exists($key, $data)) continue;
                $val = (string)$data[$key];
                try {
                    $db->prepare("DELETE FROM settings WHERE `key` = ?")->execute([$key]);
                    if (trim($val) !== '') {
                        $db->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?)")->execute([$key, $val]);
                    }
                    $saved[] = $key;
                } catch (Exception $e) {
                    jsonResponse(['error' => "Failed to save $key: " . $e->getMessage()], 500);
                }
            }
            jsonResponse(['message' => 'Wording saved', 'saved' => $saved, 'templates' => getMessageTemplates($db)]);
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
                jsonResponse(['error' => 'Text failed: ' . explainSmsError($res['response'], $res['curl_error'], (string)$settings['msg_twilio_number'])], 502);
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
                // Parked with the draft on purpose. Without it a thank-you or a
                // pledge reminder saved for later would go out with the literal
                // text {amount} in it once the per-person figures were lost.
                'merge'            => is_array($data['merge'] ?? null) ? $data['merge'] : null,
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
            // Per-person values for the placeholders, keyed by member id, e.g. the
            // gift amount on a thank-you or the outstanding balance on a pledge
            // reminder. Everyone gets the same wording but their own figures.
            $mergeExtra = is_array($data['merge'] ?? null) ? $data['merge'] : [];

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
            // The time comes off a datetime-local box, so it is Philadelphia wall
            // clock. Every other stamp in this system is UTC, and storing this one
            // raw is why a scheduled message was four hours out from the moment it
            // was saved. Convert it here, once, the same way check-in times are.
            $scheduledUtc = ($sendType === 'now') ? null : churchToUtc($data['scheduled_at'] ?? null);
            if ($sendType !== 'now') {
                if (!$scheduledUtc) {
                    jsonResponse(['error' => 'Pick the date and time you want this to go out.'], 400);
                }
                // Better to say so now than to have it sit looking scheduled.
                if (strtotime($scheduledUtc) < strtotime(utcNow()) - 300) {
                    jsonResponse(['error' => 'That time has already passed. Pick a time in the future, or choose Send now.'], 400);
                }
            }

            $stmt = $db->prepare("
                INSERT INTO messages (subject, body, message_type, send_type, scheduled_at, status, recipient_type, recipient_filter, attachment_path, merge_data, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $status = ($sendType === 'now') ? 'sending' : 'queued';
            $stmt->execute([
                $subject, $body, $messageType, $sendType,
                $scheduledUtc,
                $status, $recipientType,
                $recipientFilter ? json_encode($recipientFilter) : null,
                $attachmentPath,
                // Parked with the message on purpose. Without it a thank-you
                // scheduled for tomorrow morning would go out with the literal
                // text {amount} in it, the per-person figures having been lost
                // the moment the browser tab was closed.
                $mergeExtra ? json_encode($mergeExtra) : null,
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

            // Send it, or park it for the scheduler to pick up at its time.
            if ($sendType === 'now') {
                $result = dispatchMessage($db, $messageId, $mergeExtra, (int)$currentUser['user_id'], $currentUser['name'] ?? null);
                $skippedNote = $smsSkipped
                    ? ' - ' . count($smsSkipped) . ' skipped for SMS (no text consent on file)'
                    : '';
                jsonResponse([
                    'message' => "Sent to {$result['sent']} recipients" . ($result['failed'] > 0 ? " ({$result['failed']} failed)" : '') . $skippedNote,
                    'id' => $messageId,
                    'sent' => $result['sent'],
                    'failed' => $result['failed'],
                    'email_problems' => $result['email_problems'],
                    'sms_problems' => $result['sms_problems'],
                    'sms_skipped' => count($smsSkipped),
                    'sms_skipped_names' => array_slice($smsSkipped, 0, 50),
                ], 201);
            } else {
                jsonResponse([
                    'message' => 'Scheduled for ' . churchTime($scheduledUtc),
                    'id' => $messageId,
                    'scheduled_at' => churchTime($scheduledUtc),
                    'sms_skipped' => count($smsSkipped),
                    'sms_skipped_names' => array_slice($smsSkipped, 0, 50),
                ], 201);
            }
        }

        // Change a message that has not gone out yet - its wording, its time, or
        // both. Only ever a queued one: once something has been sent, editing the
        // record would rewrite history for a message people have already read.
        if ($action === 'update_queued') {
            requireSectionEdit($currentUser, 'communication', 'send');
            $data = getRequestBody();
            $msgId = (int)($data['id'] ?? $id ?? 0);
            if (!$msgId) jsonResponse(['error' => 'Message ID required'], 400);

            $cur = $db->prepare("SELECT status, message_type FROM messages WHERE id = ?");
            $cur->execute([$msgId]);
            $row = $cur->fetch();
            if (!$row) jsonResponse(['error' => 'That message no longer exists.'], 404);
            if ($row['status'] !== 'queued') {
                jsonResponse(['error' => 'That message is not waiting any more - it has already been sent or is going out now.'], 409);
            }

            $sets = [];
            $vals = [];
            if (array_key_exists('subject', $data)) { $sets[] = 'subject = ?'; $vals[] = (string)$data['subject']; }
            if (array_key_exists('body', $data)) {
                if (trim(strip_tags((string)$data['body'])) === '') {
                    jsonResponse(['error' => 'The message cannot be left empty.'], 400);
                }
                $sets[] = 'body = ?'; $vals[] = (string)$data['body'];
            }
            if (!empty($data['scheduled_at'])) {
                // Typed in Philadelphia time, same as the box it came from.
                $utc = churchToUtc((string)$data['scheduled_at']);
                if (!$utc) jsonResponse(['error' => 'That date and time could not be read.'], 400);
                if (strtotime($utc) < strtotime(utcNow()) + 60) {
                    jsonResponse(['error' => 'Pick a time at least a minute from now, or use Send now.'], 400);
                }
                $sets[] = 'scheduled_at = ?'; $vals[] = $utc;
            }
            if (!$sets) jsonResponse(['error' => 'Nothing to change.'], 400);

            $vals[] = $msgId;
            $db->prepare("UPDATE messages SET " . implode(', ', $sets) . " WHERE id = ? AND status = 'queued'")
               ->execute($vals);

            $after = $db->prepare("SELECT scheduled_at FROM messages WHERE id = ?");
            $after->execute([$msgId]);
            jsonResponse(['message' => 'Saved.', 'id' => $msgId, 'scheduled_at' => $after->fetchColumn()]);
        }

        // Send a message that is already sitting in the queue, right now, without
        // anybody having to type it again. This is the way out of anything the
        // scheduler has not done - a cron that stopped, a message held back for
        // being stale, or simply not wanting to wait until the morning after all.
        if ($action === 'send_now') {
            requireSectionEdit($currentUser, 'communication', 'send');
            $data = getRequestBody();
            $msgId = (int)($data['id'] ?? $id ?? 0);
            if (!$msgId) jsonResponse(['error' => 'Message ID required'], 400);

            $check = $db->prepare("SELECT status FROM messages WHERE id = ?");
            $check->execute([$msgId]);
            $st = $check->fetchColumn();
            if ($st === false)   jsonResponse(['error' => 'That message no longer exists.'], 404);
            if ($st === 'sent')  jsonResponse(['error' => 'That message has already gone out.'], 409);
            if ($st === 'draft') jsonResponse(['error' => 'That one is still a draft - open it on the Drafts tab and send it from there.'], 409);

            // Claim it before sending anything. Two people pressing the button at
            // the same moment, or the cron picking it up mid-click, must never
            // text the same person twice.
            $claim = $db->prepare("UPDATE messages SET status = 'sending' WHERE id = ? AND status = 'queued'");
            $claim->execute([$msgId]);
            if ($claim->rowCount() === 0) {
                jsonResponse(['error' => 'That message is being sent right now - give it a moment and refresh.'], 409);
            }

            $result = dispatchMessage($db, $msgId, [], (int)$currentUser['user_id'], $currentUser['name'] ?? null);
            jsonResponse([
                'message' => "Sent to {$result['sent']} recipients" . ($result['failed'] > 0 ? " ({$result['failed']} failed)" : ''),
                'id' => $msgId,
                'sent' => $result['sent'],
                'failed' => $result['failed'],
                'email_problems' => $result['email_problems'],
                'sms_problems' => $result['sms_problems'],
            ]);
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
