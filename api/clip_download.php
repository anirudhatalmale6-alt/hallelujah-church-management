<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();

$jobId = $_GET['id'] ?? '';
$ext = in_array($_GET['ext'] ?? '', ['mp4', 'mp3']) ? $_GET['ext'] : 'mp4';
$inline = ($_GET['inline'] ?? '') === '1';

if (!preg_match('/^clip_[a-f0-9\.]+$/', $jobId)) {
    http_response_code(400);
    header('Content-Type: text/plain');
    echo 'Invalid job ID';
    exit;
}

$clipsDir = dirname(__DIR__) . '/uploads/clips';
$filePath = $clipsDir . "/{$jobId}_output.{$ext}";

if (!file_exists($filePath)) {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo 'Clip not found or expired';
    exit;
}

$filename = $_GET['filename'] ?? "clip.{$ext}";
$mime = $ext === 'mp3' ? 'audio/mpeg' : 'video/mp4';
$size = filesize($filePath);

header_remove('Content-Type');
header('Content-Type: ' . $mime);
header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . addslashes($filename) . '"');
header('Cache-Control: no-store');
header('Accept-Ranges: bytes');

// Previewing a clip in the browser means the player asks for pieces of the file
// as you scrub, so byte ranges have to be served properly.
$start = 0;
$end = $size - 1;
$isRange = false;

if (!empty($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
    $isRange = true;
    if ($m[1] !== '') $start = (int)$m[1];
    if ($m[2] !== '') $end = (int)$m[2];
    if ($start > $end || $start >= $size) {
        http_response_code(416);
        header("Content-Range: bytes */{$size}");
        exit;
    }
    $end = min($end, $size - 1);
    http_response_code(206);
    header("Content-Range: bytes {$start}-{$end}/{$size}");
}

$length = $end - $start + 1;
header('Content-Length: ' . $length);

$fp = fopen($filePath, 'rb');
if ($fp === false) {
    http_response_code(500);
    exit;
}
fseek($fp, $start);
$remaining = $length;
while ($remaining > 0 && !feof($fp)) {
    $chunk = fread($fp, min(262144, $remaining));
    if ($chunk === false) break;
    echo $chunk;
    flush();
    $remaining -= strlen($chunk);
}
fclose($fp);

// The clip is left in place so it can be previewed and downloaded more than
// once (and so a whole batch of clips stays playable). Old clips are removed
// automatically an hour after they are made.
exit;
