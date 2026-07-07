<?php
require_once __DIR__ . '/config.php';
if (($_GET['key'] ?? '') !== 'hitc-ytdiag-2026') { http_response_code(403); echo 'no'; exit; }

$binDir = dirname(__DIR__) . '/bin';
$ytdlp = $binDir . '/yt-dlp';
$tmp = $binDir . '/tmp';
$cookies = $binDir . '/cookies.txt';
if (!is_dir($tmp)) @mkdir($tmp, 0755, true);

function rc($cmd, $binDir, $tmp) {
    $d = [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']];
    $env = ['TMPDIR'=>$tmp, 'HOME'=>dirname($binDir), 'PATH'=>'/usr/bin:/bin:/usr/local/bin'];
    $p = proc_open($cmd, $d, $pipes, null, $env);
    if (!is_resource($p)) return ['out'=>'','err'=>'no proc','code'=>-1];
    fclose($pipes[0]);
    $o = stream_get_contents($pipes[1]); $e = stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]);
    $code = proc_close($p);
    return ['code'=>$code,'out'=>$o,'err'=>$e];
}

$vid = $_GET['v'] ?? 'uhK9n40gmD4';
$ytUrl = "https://www.youtube.com/watch?v=$vid";
$ck = (file_exists($cookies) && filesize($cookies)>0) ? ' --cookies '.escapeshellarg($cookies) : '';

$out = ['cookies_file_bytes' => file_exists($cookies)?filesize($cookies):0];
$clients = ['web_creator','mediaconnect','android_creator','ios_creator','android_vr','default'];
foreach ($clients as $c) {
    $ea = $c === 'default' ? '' : ' --extractor-args '.escapeshellarg("youtube:player_client=$c");
    $r = rc(escapeshellarg($ytdlp).' --dump-json --no-download --no-warnings --no-playlist'.$ck.$ea.' '.escapeshellarg($ytUrl), $binDir, $tmp);
    $title = null;
    if ($r['code'] === 0) { $j = json_decode($r['out'], true); $title = $j['title'] ?? 'PARSED'; }
    $out['clients'][$c] = ['ok'=>$r['code']===0,'title'=>$title,'err'=>$r['code']!==0?substr(trim($r['err']),0,160):''];
}
header('Content-Type: application/json');
echo json_encode($out, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
