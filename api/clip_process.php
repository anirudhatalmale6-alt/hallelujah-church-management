<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(200);
    exit;
}

set_time_limit(360);
ini_set('memory_limit', '512M');

$binDir = dirname(__DIR__) . '/bin';
$ffmpeg = $binDir . '/ffmpeg';
$ytdlp = $binDir . '/yt-dlp';
$ytdlpTmp = $binDir . '/tmp';
$clipsDir = dirname(__DIR__) . '/uploads/clips';

// Optional YouTube cookies file. YouTube blocks datacenter/host IPs with a
// "Sign in to confirm you're not a bot" wall; a cookies.txt exported from a
// logged-in browser lets yt-dlp authenticate. Drop the file at bin/cookies.txt.
$cookiesFile = $binDir . '/cookies.txt';
$cookiesArg = (file_exists($cookiesFile) && filesize($cookiesFile) > 0)
    ? ' --cookies ' . escapeshellarg($cookiesFile)
    : '';

if (!is_dir($clipsDir)) mkdir($clipsDir, 0755, true);
if (!is_dir($ytdlpTmp)) mkdir($ytdlpTmp, 0755, true);

cleanupOldClips($clipsDir, 3600);

function runCmd($cmd, $env = []) {
    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];
    $fullEnv = array_merge(['TMPDIR' => $GLOBALS['ytdlpTmp'], 'HOME' => dirname($GLOBALS['binDir'])], $env);
    $process = proc_open($cmd, $descriptors, $pipes, null, $fullEnv);
    if (!is_resource($process)) return ['output' => '', 'error' => 'Failed to start process', 'code' => -1];
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $code = proc_close($process);
    return ['output' => trim($stdout), 'error' => trim($stderr), 'code' => $code];
}

function cleanupOldClips($dir, $maxAge) {
    if (!is_dir($dir)) return;
    $now = time();
    foreach (scandir($dir) as $f) {
        if ($f === '.' || $f === '..') continue;
        $path = $dir . '/' . $f;
        if (is_file($path) && ($now - filemtime($path)) > $maxAge) {
            @unlink($path);
        }
    }
}

function sanitizeFilename($name) {
    return preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $name);
}

function extractYoutubeId($url) {
    $patterns = [
        '/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/v\/)([a-zA-Z0-9_\-]{11})/',
        '/[?&]v=([a-zA-Z0-9_\-]{11})/',
    ];
    foreach ($patterns as $p) {
        if (preg_match($p, $url, $m)) return $m[1];
    }
    return null;
}

/**
 * Build one clip out of a video file already sitting on the server.
 * Returns the ffmpeg command to run.
 */
function buildCutCmd($ffmpeg, $inputPath, $outputPath, $start, $duration, $opts) {
    $q = $opts['q'];

    if (!empty($opts['audio_only'])) {
        $args = [
            escapeshellarg($ffmpeg),
            '-ss', escapeshellarg($start),
            '-i', escapeshellarg($inputPath),
            '-t', escapeshellarg($duration),
            '-vn', '-acodec', 'libmp3lame', '-b:a', $q['ab'],
            '-y', escapeshellarg($outputPath),
        ];
    } elseif (!empty($opts['watermark']) && !empty($opts['logo_path'])) {
        $size = $opts['watermark_size'];
        $pad = intval($size / 4);
        $posMap = [
            'top-left' => "overlay={$pad}:{$pad}",
            'top-right' => "overlay=main_w-overlay_w-{$pad}:{$pad}",
            'bottom-left' => "overlay={$pad}:main_h-overlay_h-{$pad}",
            'bottom-right' => "overlay=main_w-overlay_w-{$pad}:main_h-overlay_h-{$pad}",
        ];
        $filter = "[1:v]scale={$size}:{$size}[wm];[0:v][wm]" . $posMap[$opts['watermark_position']];
        $args = [
            escapeshellarg($ffmpeg),
            '-ss', escapeshellarg($start),
            '-i', escapeshellarg($inputPath),
            '-i', escapeshellarg($opts['logo_path']),
            '-t', escapeshellarg($duration),
            '-filter_complex', escapeshellarg($filter),
            '-c:v', 'libx264', '-crf', $q['crf'], '-preset', 'veryfast',
            '-c:a', 'aac', '-b:a', $q['ab'],
            '-movflags', '+faststart',
            '-y', escapeshellarg($outputPath),
        ];
    } else {
        // No watermark: copy the streams instead of re-encoding. On this shared
        // host that is the difference between a couple of seconds and minutes,
        // which matters when several clips are made in one go.
        $args = [
            escapeshellarg($ffmpeg),
            '-ss', escapeshellarg($start),
            '-i', escapeshellarg($inputPath),
            '-t', escapeshellarg($duration),
            '-c', 'copy', '-avoid_negative_ts', 'make_zero',
            '-movflags', '+faststart',
            '-y', escapeshellarg($outputPath),
        ];
    }

    // Shared hosting caps threads per process; ffmpeg's default multi-threading
    // trips that limit ("Could not open encoder"), so stay single-threaded.
    array_splice($args, 1, 0, ['-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1']);
    return implode(' ', $args) . ' 2>&1';
}

if ($method === 'POST' && ($_POST['action'] ?? '') === 'batch') {
    // --- MULTIPLE CLIPS IN ONE GO ---
    // The page works out where each clip should start (so many clips, so many
    // minutes each) and sends the list of segments; here we cut them all and
    // hand back a playable preview + download link for each one.
    $mode = $_POST['mode'] ?? 'upload';
    $quality = in_array($_POST['quality'] ?? 'medium', ['high', 'medium', 'low']) ? $_POST['quality'] : 'medium';
    $outputFormat = in_array($_POST['output_format'] ?? 'mp4', ['mp4', 'mp3']) ? $_POST['output_format'] : 'mp4';
    $watermark = ($_POST['watermark'] ?? '0') === '1';
    $watermarkPos = in_array($_POST['watermark_position'] ?? 'bottom-right', ['top-left', 'top-right', 'bottom-left', 'bottom-right']) ? $_POST['watermark_position'] : 'bottom-right';
    $watermarkSize = max(40, min(200, intval($_POST['watermark_size'] ?? 80)));

    $qualityMap = [
        'high' => ['crf' => '18', 'ab' => '192k'],
        'medium' => ['crf' => '23', 'ab' => '128k'],
        'low' => ['crf' => '28', 'ab' => '96k'],
    ];

    $segments = json_decode($_POST['segments'] ?? '[]', true);
    if (!is_array($segments) || count($segments) === 0) {
        jsonResponse(['error' => 'No clips were requested'], 400);
    }
    if (count($segments) > 8) {
        jsonResponse(['error' => 'Please ask for 8 clips or fewer at a time.'], 400);
    }

    $logoPath = dirname(__DIR__) . '/uploads/assets/ID Card logo.png';
    $opts = [
        'q' => $qualityMap[$quality],
        'audio_only' => $outputFormat === 'mp3',
        'watermark' => $watermark && file_exists($logoPath),
        'watermark_position' => $watermarkPos,
        'watermark_size' => $watermarkSize,
        'logo_path' => file_exists($logoPath) ? $logoPath : null,
    ];
    $ext = $opts['audio_only'] ? 'mp3' : 'mp4';

    @set_time_limit(900);

    $sourcePath = null;
    $baseName = 'clip';
    $ytUrl = null;

    if ($mode === 'upload') {
        if (empty($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
            jsonResponse(['error' => 'No file was uploaded'], 400);
        }
        $sourceId = uniqid('clip_', true);
        $sourcePath = $clipsDir . "/{$sourceId}_source." . pathinfo($_FILES['video']['name'], PATHINFO_EXTENSION);
        move_uploaded_file($_FILES['video']['tmp_name'], $sourcePath);
        $baseName = sanitizeFilename(pathinfo($_FILES['video']['name'], PATHINFO_FILENAME));
    } elseif ($mode === 'youtube') {
        $videoId = extractYoutubeId($_POST['youtube_url'] ?? '');
        if (!$videoId) jsonResponse(['error' => 'Invalid YouTube URL'], 400);
        $ytUrl = "https://www.youtube.com/watch?v={$videoId}";

        $infoCmd = escapeshellarg($ytdlp) . ' --dump-json --no-download --no-warnings --no-playlist' . $cookiesArg . ' ' . escapeshellarg($ytUrl);
        $infoResult = runCmd($infoCmd);
        $info = json_decode($infoResult['output'], true);
        $baseName = sanitizeFilename($info['title'] ?? 'youtube_clip');
    } else {
        jsonResponse(['error' => 'Invalid mode'], 400);
    }

    $clips = [];
    $failures = [];

    foreach ($segments as $i => $seg) {
        $start = max(0, floatval($seg['start'] ?? 0));
        $end = max(0, floatval($seg['end'] ?? 0));
        if ($end <= $start) { $failures[] = 'Clip ' . ($i + 1) . ': end time is not after the start time'; continue; }
        $duration = $end - $start;

        $jobId = uniqid('clip_', true);
        $outputPath = $clipsDir . "/{$jobId}_output.{$ext}";

        $cutFrom = $start;
        $inputPath = $sourcePath;
        $tempInput = null;

        if ($mode === 'youtube') {
            // Pull just this stretch of the video rather than the whole thing.
            $tempInput = $clipsDir . "/{$jobId}_input.mp4";
            $ppArgs = ' --ffmpeg-location ' . escapeshellarg($ffmpeg)
                . ' --postprocessor-args ' . escapeshellarg('ffmpeg:-threads 1 -filter_threads 1 -filter_complex_threads 1');
            $dlCmd = escapeshellarg($ytdlp)
                . ' --no-warnings --no-playlist'
                . $cookiesArg . $ppArgs
                . ' -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"'
                . ' --download-sections ' . escapeshellarg("*{$start}-{$end}")
                . ' --force-keyframes-at-cuts'
                . ' -o ' . escapeshellarg($tempInput)
                . ' ' . escapeshellarg($ytUrl);
            $dl = runCmd($dlCmd);

            if ($dl['code'] !== 0 || !file_exists($tempInput)) {
                $blocked = stripos($dl['error'], 'confirm') !== false
                    || stripos($dl['error'], 'bot') !== false
                    || stripos($dl['error'], 'sign in') !== false;
                $failures[] = 'Clip ' . ($i + 1) . ': ' . ($blocked
                    ? 'YouTube blocked the download from the server (this happens with live-stream recordings). Use the Upload File option for this video.'
                    : 'could not be downloaded from YouTube.');
                @unlink($tempInput);
                continue;
            }
            // yt-dlp already cut the section, so the clip starts at 0.
            $inputPath = $tempInput;
            $cutFrom = 0;
        }

        $cmd = buildCutCmd($ffmpeg, $inputPath, $outputPath, $cutFrom, $duration, $opts);
        $result = runCmd($cmd);

        // Stream copy can fail on some sources (odd codecs); re-encode as a fallback.
        if (($result['code'] !== 0 || !file_exists($outputPath)) && !$opts['watermark'] && !$opts['audio_only']) {
            $reencode = $opts;
            $reencode['watermark'] = false;
            $args = [
                escapeshellarg($ffmpeg), '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1',
                '-ss', escapeshellarg($cutFrom),
                '-i', escapeshellarg($inputPath),
                '-t', escapeshellarg($duration),
                '-c:v', 'libx264', '-crf', $opts['q']['crf'], '-preset', 'veryfast',
                '-c:a', 'aac', '-b:a', $opts['q']['ab'],
                '-movflags', '+faststart',
                '-y', escapeshellarg($outputPath),
            ];
            $result = runCmd(implode(' ', $args) . ' 2>&1');
        }

        if ($tempInput) @unlink($tempInput);

        if ($result['code'] !== 0 || !file_exists($outputPath)) {
            @unlink($outputPath);
            $failures[] = 'Clip ' . ($i + 1) . ': the video could not be processed.';
            continue;
        }

        $startFmt = sprintf('%02d-%02d-%02d', floor($start / 3600), floor(fmod($start, 3600) / 60), floor(fmod($start, 60)));
        $clips[] = [
            'job_id' => $jobId,
            'index' => $i + 1,
            'start' => $start,
            'end' => $end,
            'duration' => $duration,
            'size' => filesize($outputPath),
            'filename' => "{$baseName}_clip" . ($i + 1) . "_{$startFmt}.{$ext}",
            'ext' => $ext,
            'download_url' => '/system/api/clip_download.php?id=' . urlencode($jobId) . '&ext=' . $ext,
        ];
    }

    if ($sourcePath) @unlink($sourcePath);

    if (empty($clips)) {
        jsonResponse(['error' => $failures ? implode(' ', $failures) : 'No clips could be made.'], 500);
    }

    jsonResponse([
        'success' => true,
        'clips' => $clips,
        'warnings' => $failures,
    ]);
}

if ($method === 'POST') {
    $mode = $_POST['mode'] ?? 'upload';
    $startTime = max(0, floatval($_POST['start_time'] ?? 0));
    $endTime = max(0, floatval($_POST['end_time'] ?? 0));
    $quality = in_array($_POST['quality'] ?? 'medium', ['high', 'medium', 'low']) ? $_POST['quality'] : 'medium';
    $outputFormat = in_array($_POST['output_format'] ?? 'mp4', ['mp4', 'mp3']) ? $_POST['output_format'] : 'mp4';
    $watermark = ($_POST['watermark'] ?? '0') === '1';
    $watermarkPos = in_array($_POST['watermark_position'] ?? 'bottom-right', ['top-left', 'top-right', 'bottom-left', 'bottom-right']) ? $_POST['watermark_position'] : 'bottom-right';
    $watermarkSize = max(40, min(200, intval($_POST['watermark_size'] ?? 80)));

    $qualityMap = [
        'high' => ['crf' => '18', 'ab' => '192k'],
        'medium' => ['crf' => '23', 'ab' => '128k'],
        'low' => ['crf' => '28', 'ab' => '96k'],
    ];
    $q = $qualityMap[$quality];

    if ($endTime <= $startTime) {
        jsonResponse(['error' => 'End time must be after start time'], 400);
    }

    $duration = $endTime - $startTime;
    $jobId = uniqid('clip_', true);
    $inputPath = null;
    $baseName = 'clip';

    if ($mode === 'youtube') {
        $url = $_POST['youtube_url'] ?? '';
        $videoId = extractYoutubeId($url);
        if (!$videoId) {
            jsonResponse(['error' => 'Invalid YouTube URL'], 400);
        }

        $ytUrl = "https://www.youtube.com/watch?v={$videoId}";
        $inputPath = $clipsDir . "/{$jobId}_input.mp4";

        $ppArgs = ' --ffmpeg-location ' . escapeshellarg($ffmpeg)
            . ' --postprocessor-args ' . escapeshellarg('ffmpeg:-threads 1 -filter_threads 1 -filter_complex_threads 1');

        $dlCmd = escapeshellarg($ytdlp)
            . ' --no-warnings --no-playlist'
            . $cookiesArg . $ppArgs
            . ' -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"'
            . ' --download-sections ' . escapeshellarg("*{$startTime}-{$endTime}")
            . ' --force-keyframes-at-cuts'
            . ' -o ' . escapeshellarg($inputPath)
            . ' ' . escapeshellarg($ytUrl);

        $dlResult = runCmd($dlCmd);
        if ($dlResult['code'] !== 0 || !file_exists($inputPath)) {
            $fallbackCmd = escapeshellarg($ytdlp)
                . ' --no-warnings --no-playlist'
                . $cookiesArg . $ppArgs
                . ' -f "best[height<=720][ext=mp4]/best"'
                . ' --download-sections ' . escapeshellarg("*{$startTime}-{$endTime}")
                . ' --force-keyframes-at-cuts'
                . ' -o ' . escapeshellarg($inputPath)
                . ' ' . escapeshellarg($ytUrl);
            $dlResult = runCmd($fallbackCmd);

            if ($dlResult['code'] !== 0 || !file_exists($inputPath)) {
                @unlink($inputPath);
                $blocked = stripos($dlResult['error'], 'confirm') !== false
                    || stripos($dlResult['error'], 'bot') !== false
                    || stripos($dlResult['error'], 'sign in') !== false;
                $msg = $blocked
                    ? 'YouTube is currently blocking downloads from the server for this video. Please use the "Upload File" option to upload the video instead, or contact support to enable YouTube link access.'
                    : 'Failed to download YouTube video. Please try again or use a different URL.';
                jsonResponse(['error' => $msg, 'detail' => $dlResult['error']], 500);
            }
        }

        $infoCmd = escapeshellarg($ytdlp) . ' --dump-json --no-download' . $cookiesArg . ' ' . escapeshellarg($ytUrl);
        $infoResult = runCmd($infoCmd);
        $info = json_decode($infoResult['output'], true);
        $baseName = sanitizeFilename($info['title'] ?? 'youtube_clip');

    } elseif ($mode === 'upload') {
        if (empty($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
            $errorMessages = [
                UPLOAD_ERR_INI_SIZE => 'File exceeds server upload limit',
                UPLOAD_ERR_FORM_SIZE => 'File exceeds form upload limit',
                UPLOAD_ERR_PARTIAL => 'File was only partially uploaded',
                UPLOAD_ERR_NO_FILE => 'No file was uploaded',
            ];
            $errCode = $_FILES['video']['error'] ?? UPLOAD_ERR_NO_FILE;
            jsonResponse(['error' => $errorMessages[$errCode] ?? 'Upload failed'], 400);
        }

        $inputPath = $clipsDir . "/{$jobId}_input." . pathinfo($_FILES['video']['name'], PATHINFO_EXTENSION);
        move_uploaded_file($_FILES['video']['tmp_name'], $inputPath);
        $baseName = sanitizeFilename(pathinfo($_FILES['video']['name'], PATHINFO_FILENAME));
    } else {
        jsonResponse(['error' => 'Invalid mode'], 400);
    }

    $isAudioOnly = $outputFormat === 'mp3';
    $ext = $isAudioOnly ? 'mp3' : 'mp4';
    $outputPath = $clipsDir . "/{$jobId}_output.{$ext}";

    $startFmt = sprintf('%02d%02d%02d', floor($startTime/3600), floor(fmod($startTime,3600)/60), floor(fmod($startTime,60)));
    $endFmt = sprintf('%02d%02d%02d', floor($endTime/3600), floor(fmod($endTime,3600)/60), floor(fmod($endTime,60)));
    $outputName = "{$baseName}_clip_{$startFmt}-{$endFmt}.{$ext}";

    if ($mode === 'upload') {
        $args = [
            escapeshellarg($ffmpeg),
            '-ss', escapeshellarg($startTime),
            '-i', escapeshellarg($inputPath),
            '-t', escapeshellarg($duration),
        ];
    } else {
        $args = [
            escapeshellarg($ffmpeg),
            '-i', escapeshellarg($inputPath),
        ];
    }

    if ($isAudioOnly) {
        $args = array_merge($args, [
            '-vn', '-acodec', 'libmp3lame', '-b:a', $q['ab'],
            '-y', escapeshellarg($outputPath),
        ]);
    } else {
        if ($watermark) {
            $logoPath = dirname(__DIR__) . '/uploads/assets/ID Card logo.png';
            if (file_exists($logoPath)) {
                $posMap = [
                    'top-left' => 'overlay=' . intval($watermarkSize/4) . ':' . intval($watermarkSize/4),
                    'top-right' => 'overlay=main_w-overlay_w-' . intval($watermarkSize/4) . ':' . intval($watermarkSize/4),
                    'bottom-left' => 'overlay=' . intval($watermarkSize/4) . ':main_h-overlay_h-' . intval($watermarkSize/4),
                    'bottom-right' => 'overlay=main_w-overlay_w-' . intval($watermarkSize/4) . ':main_h-overlay_h-' . intval($watermarkSize/4),
                ];
                $filter = "[1:v]scale={$watermarkSize}:{$watermarkSize}[wm];[0:v][wm]" . $posMap[$watermarkPos];
                $args = [
                    escapeshellarg($ffmpeg),
                    '-ss', escapeshellarg($startTime),
                    '-i', escapeshellarg($inputPath),
                    '-i', escapeshellarg($logoPath),
                    '-t', escapeshellarg($duration),
                    '-filter_complex', escapeshellarg($filter),
                    '-c:v', 'libx264', '-crf', $q['crf'], '-preset', 'fast',
                    '-c:a', 'aac', '-b:a', $q['ab'],
                    '-movflags', '+faststart',
                    '-y', escapeshellarg($outputPath),
                ];
                if ($mode === 'youtube') {
                    $args = [
                        escapeshellarg($ffmpeg),
                        '-i', escapeshellarg($inputPath),
                        '-i', escapeshellarg($logoPath),
                        '-filter_complex', escapeshellarg($filter),
                        '-c:v', 'libx264', '-crf', $q['crf'], '-preset', 'fast',
                        '-c:a', 'aac', '-b:a', $q['ab'],
                        '-movflags', '+faststart',
                        '-y', escapeshellarg($outputPath),
                    ];
                }
            } else {
                $watermark = false;
            }
        }

        if (!$watermark) {
            $args = array_merge($args, [
                '-c:v', 'libx264', '-crf', $q['crf'], '-preset', 'fast',
                '-c:a', 'aac', '-b:a', $q['ab'],
                '-movflags', '+faststart',
                '-y', escapeshellarg($outputPath),
            ]);
        }
    }

    // Shared hosting caps how many threads a process may spawn; ffmpeg's default
    // multi-threaded encoding hits that limit and fails with "Resource temporarily
    // unavailable / Could not open encoder". Force single-threaded to stay under it.
    array_splice($args, 1, 0, ['-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1']);

    $cmd = implode(' ', $args) . ' 2>&1';
    $result = runCmd($cmd);

    @unlink($inputPath);

    if ($result['code'] !== 0 || !file_exists($outputPath)) {
        @unlink($outputPath);
        jsonResponse(['error' => 'FFmpeg processing failed', 'detail' => $result['error'] ?: $result['output']], 500);
    }

    $fileSize = filesize($outputPath);
    $downloadUrl = '/system/api/clip_download.php?id=' . urlencode($jobId) . '&ext=' . $ext;

    jsonResponse([
        'success' => true,
        'download_url' => $downloadUrl,
        'filename' => $outputName,
        'size' => $fileSize,
        'job_id' => $jobId,
    ]);

} elseif ($method === 'GET' && isset($_GET['youtube_info'])) {
    $url = $_GET['youtube_info'];
    $videoId = extractYoutubeId($url);
    if (!$videoId) {
        jsonResponse(['error' => 'Invalid YouTube URL'], 400);
    }

    $ytUrl = "https://www.youtube.com/watch?v={$videoId}";
    $cmd = escapeshellarg($ytdlp) . ' --dump-json --no-download --no-warnings --no-playlist' . $cookiesArg . ' ' . escapeshellarg($ytUrl);
    $result = runCmd($cmd);

    if ($result['code'] !== 0) {
        $blocked = stripos($result['error'], 'confirm') !== false
            || stripos($result['error'], 'bot') !== false
            || stripos($result['error'], 'sign in') !== false;
        $msg = $blocked
            ? 'YouTube is currently blocking downloads from the server for this video. Please use the "Upload File" option to upload the video instead, or contact support to enable YouTube link access.'
            : 'Could not fetch video info';
        jsonResponse(['error' => $msg, 'detail' => $result['error']], 500);
    }

    $info = json_decode($result['output'], true);
    if (!$info) {
        jsonResponse(['error' => 'Failed to parse video info'], 500);
    }

    jsonResponse([
        'title' => $info['title'] ?? 'Unknown',
        'duration' => $info['duration'] ?? 0,
        'thumbnail' => $info['thumbnail'] ?? '',
        'video_id' => $videoId,
        'uploader' => $info['uploader'] ?? '',
    ]);

} else {
    jsonResponse(['error' => 'Method not allowed'], 405);
}
