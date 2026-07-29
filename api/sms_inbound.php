<?php
// Twilio calls this URL whenever someone TEXTS the church number back.
// It is intentionally UNAUTHENTICATED (Twilio has no login) but is protected by
// validating Twilio's X-Twilio-Signature with our own Auth Token, so nobody can
// forge inbound texts or opt people out. Records the reply so it shows up in the
// Communication > Inbox, and keeps STOP/START consent in sync.
require_once __DIR__ . '/config.php';

function twiml($msg = '') {
    header('Content-Type: text/xml; charset=utf-8');
    if ($msg === '') { echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'; }
    else { echo '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' . htmlspecialchars($msg, ENT_XML1) . '</Message></Response>'; }
    exit;
}

$db = getDB();

// --- Load Twilio auth token from settings for signature validation ---
$authToken = '';
try {
    $st = $db->prepare("SELECT `value` FROM settings WHERE `key` = 'msg_twilio_token'");
    $st->execute();
    $authToken = (string)$st->fetchColumn();
} catch (Exception $e) {}

// --- Validate X-Twilio-Signature (skip only if we have no token yet) ---
// Twilio signs: base64(HMAC-SHA1(authToken, fullUrl + each POST key+value sorted by key)).
if ($authToken !== '') {
    $sig = $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '';
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') == 443 ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'hallelujahinthecity.org';
    $uri  = $_SERVER['REQUEST_URI'] ?? '/system/api/sms_inbound.php';
    // Try a few URL spellings so a proxy/host quirk doesn't reject real Twilio calls
    $candidates = array_unique([
        $scheme . '://' . $host . $uri,
        'https://' . $host . $uri,
        'https://hallelujahinthecity.org' . $uri,
        'https://www.hallelujahinthecity.org' . $uri,
    ]);
    $post = $_POST;
    ksort($post);
    $tail = '';
    foreach ($post as $k => $v) $tail .= $k . $v;
    $ok = false;
    foreach ($candidates as $url) {
        $expected = base64_encode(hash_hmac('sha1', $url . $tail, $authToken, true));
        if (hash_equals($expected, $sig)) { $ok = true; break; }
    }
    if (!$ok) { http_response_code(403); twiml(); }
}

// --- Extract the message ---
$from = trim($_POST['From'] ?? '');   // sender's phone, E.164
$body = trim($_POST['Body'] ?? '');
$sid  = trim($_POST['MessageSid'] ?? ($_POST['SmsSid'] ?? ''));
if ($from === '') twiml();

$memberId = findMemberByPhone($db, $from);

// --- Keep consent in sync with standard opt-out / opt-in keywords ---
$word = strtoupper(preg_replace('/[^A-Za-z]/', '', $body));
$STOP  = ['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'];
$START = ['START','YES','UNSTOP'];
if ($memberId && in_array($word, $STOP, true)) {
    $db->prepare("UPDATE members SET sms_consent = 0, sms_opted_out_at = NOW() WHERE id = ?")->execute([$memberId]);
} elseif ($memberId && in_array($word, $START, true)) {
    $db->prepare("UPDATE members SET sms_consent = 1, sms_opted_out_at = NULL, sms_consent_source = 'sms_keyword', sms_consent_at = NOW() WHERE id = ?")->execute([$memberId]);
}

// --- Record the reply for the Inbox ---
logSmsConversation($db, $memberId, $from, 'in', $body, $sid ?: null, null, false);

// A new reply re-opens the thread even if it had been marked Done, so it can't
// be missed.
try {
    $db->prepare("INSERT INTO sms_conversation_state (phone, status, updated_at) VALUES (?, 'open', NOW())
                  ON DUPLICATE KEY UPDATE status = 'open', updated_at = NOW()")->execute([$from]);
} catch (Exception $e) { /* table may not exist yet; ignore */ }

// Empty response = no auto-reply (Twilio still auto-handles STOP/HELP replies)
twiml();
