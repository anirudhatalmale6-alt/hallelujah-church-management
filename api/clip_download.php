<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();

$jobId = $_GET['id'] ?? '';
$ext = in_array($_GET['ext'] ?? '', ['mp4', 'mp3']) ? $_GET['ext'] : 'mp4';

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

header_remove('Content-Type');
header('Content-Type: ' . $mime);
header('Content-Disposition: attachment; filename="' . addslashes($filename) . '"');
header('Content-Length: ' . filesize($filePath));
header('Cache-Control: no-store');

readfile($filePath);

@unlink($filePath);
exit;
