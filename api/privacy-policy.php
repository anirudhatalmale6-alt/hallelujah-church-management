<?php
/**
 * SMS Privacy Policy - Required for Twilio A2P 10DLC compliance
 */

// Get church settings
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'u802978444_church_mgmt');
define('DB_USER', getenv('DB_USER') ?: 'u802978444_hallelujah');
define('DB_PASS', getenv('DB_PASS') ?: 'FMlEjeV:1');

try {
    $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
    $db = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $settingsStmt = $db->query("SELECT `key`, value FROM settings WHERE `key` IN ('church_name', 'church_address')");
    $settings = [];
    while ($row = $settingsStmt->fetch()) {
        $settings[$row['key']] = $row['value'];
    }
} catch (PDOException $e) {
    $settings = [];
}

$churchName = htmlspecialchars($settings['church_name'] ?? 'Hallelujah In The City');
$churchAddress = htmlspecialchars($settings['church_address'] ?? '');

header('Content-Type: text/html; charset=UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SMS & Privacy Policy - <?= $churchName ?></title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8f9fa; color: #333; line-height: 1.7;
    }
    .header {
      background: linear-gradient(135deg, #0f0c29 0%, #1a1a2e 50%, #0f3460 100%);
      color: #fff; padding: 40px 20px; text-align: center;
    }
    .header h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
    .header p { font-size: 14px; color: rgba(255,255,255,0.6); }
    .content {
      max-width: 800px; margin: 0 auto; padding: 40px 20px;
    }
    h2 {
      font-size: 20px; font-weight: 700; color: #1a1a2e;
      margin: 32px 0 12px; padding-bottom: 8px;
      border-bottom: 2px solid #e8d44d;
    }
    h2:first-child { margin-top: 0; }
    p, li { font-size: 15px; margin-bottom: 12px; }
    ul { padding-left: 24px; margin-bottom: 16px; }
    li { margin-bottom: 6px; }
    .highlight {
      background: #fff8e1; border-left: 4px solid #e8d44d;
      padding: 16px 20px; border-radius: 0 8px 8px 0;
      margin: 16px 0;
    }
    .footer {
      text-align: center; padding: 24px; color: #999;
      font-size: 13px; border-top: 1px solid #eee; margin-top: 40px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1><?= $churchName ?></h1>
    <p>SMS Messaging & Privacy Policy</p>
  </div>
  <div class="content">
    <h2>SMS Messaging Policy</h2>
    <p><?= $churchName ?> uses text messaging (SMS/MMS) to communicate with our members and attendees who have opted in to receive messages. Our messaging service is used for church-related communications only.</p>

    <h3 style="margin: 20px 0 10px; font-size: 17px;">Types of Messages</h3>
    <ul>
      <li>Service reminders and schedule updates</li>
      <li>Event invitations and announcements</li>
      <li>Attendance confirmations and check-in notifications</li>
      <li>Digital ID card links</li>
      <li>Ministry updates and important notices</li>
      <li>Follow-up messages for visitors and new members</li>
    </ul>

    <h3 style="margin: 20px 0 10px; font-size: 17px;">Message Frequency</h3>
    <p>Message frequency varies. You may receive up to 10 messages per month depending on church activities and events. Message and data rates may apply.</p>

    <h2>How You Opt In</h2>
    <p>You opt in to receive SMS messages from <?= $churchName ?> by:</p>
    <ul>
      <li>Providing your phone number during church registration (in person or online)</li>
      <li>Filling out a visitor or membership form with your phone number</li>
      <li>Verbally requesting to be added to our messaging list</li>
      <li>Scanning a QR code at our church that links to registration</li>
    </ul>
    <p>By providing your phone number through any of these methods, you consent to receive text messages from <?= $churchName ?>.</p>

    <h2>How to Opt Out</h2>
    <div class="highlight">
      <p style="margin-bottom:0"><strong>To stop receiving messages at any time, reply STOP to any message you receive from us.</strong> You will receive a confirmation message and will no longer receive SMS messages from <?= $churchName ?>. You can also contact us directly to request removal from our messaging list.</p>
    </div>
    <p>For help, reply HELP to any message or contact us at the address below.</p>

    <h2>Privacy Policy</h2>
    <p><?= $churchName ?> is committed to protecting the privacy of our members and attendees.</p>

    <h3 style="margin: 20px 0 10px; font-size: 17px;">Information We Collect</h3>
    <ul>
      <li>Name, phone number, and email address provided during registration</li>
      <li>Attendance records for church services and events</li>
      <li>Information you voluntarily provide for church membership</li>
    </ul>

    <h3 style="margin: 20px 0 10px; font-size: 17px;">How We Use Your Information</h3>
    <ul>
      <li>To send church-related SMS messages as described above</li>
      <li>To manage attendance and membership records</li>
      <li>To communicate important church updates</li>
      <li>To provide pastoral care and follow-up</li>
    </ul>

    <h3 style="margin: 20px 0 10px; font-size: 17px;">Information Sharing</h3>
    <p><strong>We do not sell, rent, or share your mobile phone number or personal information with third parties for marketing purposes.</strong> Your information is used solely for church operations and communications.</p>
    <p>We may use third-party service providers (such as Twilio) to deliver SMS messages on our behalf. These providers are contractually obligated to keep your information confidential and use it only for delivering our messages.</p>

    <h3 style="margin: 20px 0 10px; font-size: 17px;">Data Security</h3>
    <p>We implement reasonable security measures to protect your personal information from unauthorized access, alteration, or disclosure.</p>

    <h3 style="margin: 20px 0 10px; font-size: 17px;">Contact Us</h3>
    <?php if ($churchAddress): ?>
      <p><?= $churchName ?><br><?= nl2br($churchAddress) ?></p>
    <?php else: ?>
      <p><?= $churchName ?></p>
    <?php endif; ?>
    <p>Website: <a href="https://hallelujahinthecity.org">hallelujahinthecity.org</a></p>

    <h2>Changes to This Policy</h2>
    <p>We may update this policy from time to time. Any changes will be posted on this page with an updated effective date.</p>
    <p><strong>Effective Date:</strong> June 25, 2026</p>
  </div>
  <div class="footer">
    &copy; <?= date('Y') ?> <?= $churchName ?>. All rights reserved.
  </div>
</body>
</html>
