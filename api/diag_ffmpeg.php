<?php
require_once __DIR__ . '/config.php';
if (($_GET['key'] ?? '') !== 'hitc-ffdiag-2026') { http_response_code(403); echo 'no'; exit; }

$binDir = dirname(__DIR__) . '/bin';
$ffmpeg = $binDir . '/ffmpeg';
$tmp = $binDir . '/tmp';
if (!is_dir($tmp)) @mkdir($tmp, 0755, true);
$logoPath = dirname(__DIR__) . '/uploads/assets/ID Card logo.png';

function rc($cmd, $binDir, $tmp) {
    $d = [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']];
    $env = ['TMPDIR'=>$tmp, 'HOME'=>dirname($binDir), 'PATH'=>'/usr/bin:/bin:/usr/local/bin'];
    $p = proc_open($cmd, $d, $pipes, null, $env);
    if (!is_resource($p)) return ['out'=>'','err'=>'no proc','code'=>-1];
    fclose($pipes[0]);
    $o = stream_get_contents($pipes[1]); $e = stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]);
    $code = proc_close($p);
    return ['code'=>$code, 'err'=>substr(trim($e ?: $o), -600)];
}

$out = [];
$out['ffmpeg_exists'] = file_exists($ffmpeg);
$out['ffmpeg_executable'] = is_executable($ffmpeg);
$out['logo_exists'] = file_exists($logoPath);
$out['logo_size'] = file_exists($logoPath) ? filesize($logoPath) : 0;
$out['version'] = rc(escapeshellarg($ffmpeg).' -version', $binDir, $tmp);
$out['encoders'] = rc(escapeshellarg($ffmpeg).' -hide_banner -encoders 2>&1 | grep -Ei "libx264|aac|libmp3lame"', $binDir, $tmp);

$TL = '-threads 1 -filter_threads 1 -filter_complex_threads 1';

// 1) make a test AVI (mpeg4 video + mp3 audio, common AVI codecs) - single threaded
$testAvi = $tmp . '/diag_test.avi';
@unlink($testAvi);
$out['make_avi'] = rc(escapeshellarg($ffmpeg).' -y '.$TL.' -f lavfi -i testsrc=size=640x360:rate=25:duration=60 -f lavfi -i sine=frequency=440:duration=60 -c:v mpeg4 -qscale:v 5 -c:a libmp3lame '.escapeshellarg($testAvi), $binDir, $tmp);
$out['avi_created'] = file_exists($testAvi) ? filesize($testAvi) : 0;

// 2) plain upload-mode clip (no watermark): -ss 34 -i avi -t 11 -> libx264/aac mp4
$outNoWm = $tmp . '/diag_out_nowm.mp4';
@unlink($outNoWm);
$out['clip_no_watermark'] = rc(escapeshellarg($ffmpeg).' -ss 34 -i '.escapeshellarg($testAvi).' -t 11 '.$TL.' -c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k -movflags +faststart -y '.escapeshellarg($outNoWm).' 2>&1', $binDir, $tmp);
$out['nowm_created'] = file_exists($outNoWm) ? filesize($outNoWm) : 0;

// 3) watermark pipeline (only if logo present)
if ($out['logo_exists']) {
    $outWm = $tmp . '/diag_out_wm.mp4';
    @unlink($outWm);
    $filter = "[1:v]scale=80:80[wm];[0:v][wm]overlay=main_w-overlay_w-20:main_h-overlay_h-20";
    $out['clip_watermark'] = rc(escapeshellarg($ffmpeg).' -ss 34 -i '.escapeshellarg($testAvi).' -i '.escapeshellarg($logoPath).' -t 11 '.$TL.' -filter_complex '.escapeshellarg($filter).' -c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k -movflags +faststart -y '.escapeshellarg($outWm).' 2>&1', $binDir, $tmp);
    $out['wm_created'] = file_exists($outWm) ? filesize($outWm) : 0;
    @unlink($outWm);
}
@unlink($testAvi); @unlink($outNoWm);

header('Content-Type: application/json');
echo json_encode($out, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
