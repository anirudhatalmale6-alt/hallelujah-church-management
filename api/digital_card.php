<?php
/**
 * Digital ID Card - Public shareable page
 * URL: /system/api/digital_card.php?code=MEMBER_QR_CODE
 */

error_reporting(E_ALL);
ini_set('display_errors', 0);

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'u802978444_church_mgmt');
define('DB_USER', getenv('DB_USER') ?: 'u802978444_hallelujah');
define('DB_PASS', getenv('DB_PASS') ?: 'FMlEjeV:1');

$code = trim($_GET['code'] ?? '');
if (!$code) {
    http_response_code(404);
    echo 'Card not found.';
    exit;
}

try {
    $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
    $db = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo 'Service unavailable.';
    exit;
}

$stmt = $db->prepare("
    SELECT m.first_name, m.last_name, m.photo_url, m.person_type, m.card_title, m.card_expiry_date,
           c.qr_code, c.pin_code
    FROM member_checkin_codes c
    JOIN members m ON m.id = c.member_id
    WHERE c.qr_code = ?
    LIMIT 1
");
$stmt->execute([$code]);
$member = $stmt->fetch();

if (!$member) {
    http_response_code(404);
    echo 'Card not found.';
    exit;
}

$settingsStmt = $db->query("SELECT `key`, value FROM settings WHERE `key` IN ('church_name', 'church_address', 'person_types')");
$settings = [];
while ($row = $settingsStmt->fetch()) {
    $settings[$row['key']] = $row['value'];
}

$churchName = htmlspecialchars($settings['church_name'] ?? 'Hallelujah In The City');
$churchAddress = htmlspecialchars($settings['church_address'] ?? '');
$cardExpiryDate = $member['card_expiry_date'] ?? '';
$expiryFormatted = $cardExpiryDate ? date('m/d/Y', strtotime($cardExpiryDate)) : '';
$memberName = htmlspecialchars($member['first_name'] . ' ' . $member['last_name']);
$qrCode = htmlspecialchars($member['qr_code']);
$pinCode = htmlspecialchars($member['pin_code']);

// Person-type labels come from the church's Settings, so a renamed type
// (e.g. "Non-Member Attendee" -> "Congregant") shows correctly on the card.
// The hardcoded values are only a fallback for types not in the custom list.
$typeLabels = [
    'church_member' => 'Member',
    'non_member_attendee' => 'Attendee',
    'community' => 'Community',
    'companion' => 'Companion',
];
if (!empty($settings['person_types'])) {
    $decodedTypes = json_decode($settings['person_types'], true);
    if (is_array($decodedTypes)) {
        foreach ($decodedTypes as $t) {
            if (empty($t['value'])) continue;
            $tv = preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace(' ', '_', $t['value'])));
            $typeLabels[$tv] = $t['label'] ?? $t['value'];
        }
    }
}
$title = htmlspecialchars($member['card_title'] ?: ($typeLabels[$member['person_type']] ?? ''));

$initials = strtoupper(
    mb_substr($member['first_name'] ?? '', 0, 1) .
    mb_substr($member['last_name'] ?? '', 0, 1)
);

// Make photo URL absolute
$photoUrl = $member['photo_url'] ? htmlspecialchars($member['photo_url']) : '';
if ($photoUrl && strpos($photoUrl, 'http') !== 0) {
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'hallelujahinthecity.org';
    $photoUrl = $scheme . '://' . $host . (strpos($photoUrl, '/') === 0 ? '' : '/') . $photoUrl;
}

$photoHtml = $photoUrl
    ? '<img src="' . $photoUrl . '?v=' . time() . '" class="photo" alt="' . $memberName . '" />'
    : '<div class="photo-placeholder">' . htmlspecialchars($initials) . '</div>';

$logoUrl = '/system/uploads/assets/ID Card logo.png';
$headerUrl = '/system/uploads/assets/ID Card header.png';

// Card URL for sharing
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'hallelujahinthecity.org';
$cardUrl = $scheme . '://' . $host . '/system/api/digital_card.php?code=' . urlencode($member['qr_code']);
$memberNameRaw = $member['first_name'] . ' ' . $member['last_name'];

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Digital ID - <?= $memberName ?></title>
  <meta property="og:title" content="<?= $memberName ?> - <?= $churchName ?>" />
  <meta property="og:description" content="Digital ID Card" />
  <script src="https://cdn.jsdelivr.net/npm/dom-to-image-more@3/dist/dom-to-image-more.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%; width: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f0c29 0%, #1a1a2e 40%, #16213e 70%, #0f3460 100%);
      color: #fff;
      overflow-x: hidden;
    }
    .container {
      min-height: 100vh;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 20px;
    }
    .digital-card {
      width: 100%; max-width: 380px;
      background: rgba(255,255,255,0.06);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.15);
      padding: 32px 24px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .logo-area { margin-bottom: 12px; }
    .logo-area img {
      width: 120px; height: 120px; border-radius: 50%;
      object-fit: cover; border: 2px solid rgba(232,212,77,0.5);
    }
    .header-area { margin-bottom: 24px; }
    .header-area img {
      max-width: 280px; width: 100%; height: auto;
    }
    .divider {
      width: 60px; height: 2px; background: rgba(232,212,77,0.4);
      margin: 0 auto 24px;
    }
    .photo {
      width: 100px; height: 120px; object-fit: cover;
      border-radius: 12px; border: 3px solid rgba(255,255,255,0.3);
      margin-bottom: 16px;
    }
    .photo-placeholder {
      width: 100px; height: 120px;
      background: rgba(255,255,255,0.1);
      border-radius: 12px; border: 3px solid rgba(255,255,255,0.2);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 32px; font-weight: bold; color: rgba(255,255,255,0.4);
      margin-bottom: 16px;
    }
    .member-name {
      font-size: 24px; font-weight: 700;
      color: #fff; margin-bottom: 4px;
    }
    .member-title {
      font-size: 13px; font-weight: 600;
      color: #e8d44d; text-transform: uppercase;
      letter-spacing: 1.5px; margin-bottom: 20px;
    }
    .expiry-info {
      font-size: 11px; color: rgba(255,255,255,0.6);
      font-weight: 600; letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .qr-section {
      background: #fff; border-radius: 16px;
      padding: 16px; margin: 20px auto 16px;
      display: inline-block;
    }
    .qr-section img { width: 180px; height: 180px; display: block; }
    .scan-text {
      font-size: 11px; color: rgba(255,255,255,0.5);
      margin-top: 8px; letter-spacing: 0.5px;
    }
    .footer-info {
      margin-top: 24px; padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
    .footer-info .addr {
      font-size: 11px; color: rgba(255,255,255,0.4);
      line-height: 1.4;
    }
    .code-text {
      font-size: 10px; color: rgba(255,255,255,0.3);
      font-family: monospace; margin-top: 12px; letter-spacing: 1px;
    }
    .action-buttons {
      display: flex; flex-wrap: wrap; gap: 10px;
      justify-content: center;
      margin-top: 24px; max-width: 380px; width: 100%;
    }
    .action-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 20px; border-radius: 12px;
      font-size: 14px; font-weight: 600;
      cursor: pointer; border: none;
      text-decoration: none;
      transition: transform 0.15s, opacity 0.15s;
    }
    .action-btn:active { transform: scale(0.96); }
    .btn-download {
      background: #e8d44d; color: #1a1a2e;
      flex: 1; justify-content: center; min-width: 140px;
    }
    .btn-download:hover { background: #d4c244; }
    .btn-share {
      background: rgba(255,255,255,0.15); color: #fff;
      border: 1px solid rgba(255,255,255,0.25);
      flex: 1; justify-content: center; min-width: 140px;
    }
    .btn-share:hover { background: rgba(255,255,255,0.25); }
    .btn-sms {
      background: #25D366; color: #fff;
      flex: 1; justify-content: center; min-width: 140px;
    }
    .btn-sms:hover { background: #1fb855; }
    .btn-icon {
      width: 20px; height: 20px; display: inline-block;
    }
    .toast {
      position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
      background: #333; color: #fff; padding: 12px 24px; border-radius: 12px;
      font-size: 14px; font-weight: 500; z-index: 100;
      opacity: 0; transition: opacity 0.3s;
      pointer-events: none;
    }
    .toast.show { opacity: 1; }
    @media print {
      .action-buttons { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="digital-card" id="card-element">
      <div class="logo-area"><img src="<?= $logoUrl ?>" alt="Logo" onerror="this.style.display='none'" /></div>
      <div class="header-area"><img src="<?= $headerUrl ?>" alt="<?= $churchName ?>" onerror="this.textContent='<?= $churchName ?>'; this.style.cssText='font-size:20px;font-weight:800;color:#e8d44d;letter-spacing:1.5px;text-transform:uppercase;'" /></div>
      <div class="divider"></div>
      <?= $photoHtml ?>
      <div class="member-name"><?= $memberName ?></div>
      <?php if ($title): ?>
        <div class="member-title"><?= $title ?></div>
      <?php else: ?>
        <div style="margin-bottom:20px"></div>
      <?php endif; ?>
      <?php if ($expiryFormatted): ?>
        <div class="expiry-info">EXPIRES: <?= htmlspecialchars($expiryFormatted) ?></div>
      <?php endif; ?>
      <div class="qr-section">
        <img id="qr-img" alt="QR Code" />
      </div>
      <div class="scan-text">Scan QR code for check-in</div>
      <?php if ($churchAddress): ?>
        <div class="footer-info"><div class="addr"><?= $churchAddress ?></div></div>
      <?php endif; ?>
      <div class="code-text"><?= $qrCode ?></div>
    </div>

    <div class="action-buttons">
      <button class="action-btn btn-download" onclick="downloadCard()">
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Save Card
      </button>
      <button class="action-btn btn-share" onclick="shareCard()">
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </button>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    (function(){
      var qr = new QRious({
        value: <?= json_encode($member['qr_code']) ?>,
        size: 360,
        foreground: '#000000',
        background: '#ffffff',
        level: 'M'
      });
      document.getElementById('qr-img').src = qr.toDataURL('image/png');
    })();

    function showToast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(function() { t.classList.remove('show'); }, 3000);
    }

    function downloadCard() {
      var card = document.getElementById('card-element');
      var btn = event.currentTarget;
      btn.textContent = 'Generating...';
      btn.disabled = true;

      var origBg = card.style.background;
      card.style.background = 'linear-gradient(135deg, #0f0c29 0%, #1a1a2e 40%, #16213e 70%, #0f3460 100%)';

      var scale = 2;
      var w = card.offsetWidth;
      var h = card.offsetHeight;

      domtoimage.toPng(card, {
        width: w * scale,
        height: h * scale,
        style: {
          transform: 'scale(' + scale + ')',
          transformOrigin: 'top left',
          width: w + 'px',
          height: h + 'px'
        }
      }).then(function(dataUrl) {
        var link = document.createElement('a');
        link.download = <?= json_encode(str_replace(' ', '-', strtolower($memberNameRaw))) ?> + '-id-card.png';
        link.href = dataUrl;
        link.click();
        showToast('Card saved!');
      }).catch(function() {
        showToast('Could not generate image. Try taking a screenshot instead.');
      }).finally(function() {
        card.style.background = origBg;
        btn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save Card';
        btn.disabled = false;
      });
    }

    function shareCard() {
      var cardUrl = <?= json_encode($cardUrl) ?>;
      var memberName = <?= json_encode($memberNameRaw) ?>;
      var churchName = <?= json_encode($settings['church_name'] ?? 'Hallelujah In The City') ?>;

      if (navigator.share) {
        navigator.share({
          title: 'Digital ID - ' + memberName,
          text: memberName + ' - ' + churchName + ' Digital ID Card',
          url: cardUrl
        }).catch(function(e) {
          if (e.name !== 'AbortError') {
            copyToClipboard(cardUrl);
          }
        });
      } else {
        copyToClipboard(cardUrl);
      }
    }

    function copyToClipboard(url) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function() {
          showToast('Card link copied! Paste it in a text or email.');
        }).catch(function() {
          fallbackCopy(url);
        });
      } else {
        fallbackCopy(url);
      }
    }

    function fallbackCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast('Card link copied!');
      } catch(e) {
        showToast('Link: ' + text);
      }
      document.body.removeChild(ta);
    }
  </script>
</body>
</html>
