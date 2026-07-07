<?php
header('Content-Type: application/json');

function run_command($cmd) {
    $descriptorspec = [
        0 => ["pipe", "r"],
        1 => ["pipe", "w"],
        2 => ["pipe", "w"]
    ];
    $process = proc_open($cmd, $descriptorspec, $pipes);
    if (!is_resource($process)) return ['error' => 'proc_open failed'];
    
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exit = proc_close($process);
    
    return ['stdout' => trim($stdout), 'stderr' => trim($stderr), 'exit' => $exit];
}

$result = [];
$result['which_ffmpeg'] = run_command('which ffmpeg 2>&1');
$result['which_ffprobe'] = run_command('which ffprobe 2>&1');

if ($result['which_ffmpeg']['exit'] === 0) {
    $result['ffmpeg_version'] = run_command('ffmpeg -version 2>&1 | head -1');
}

// Try common paths
$paths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/cpanel/3rdparty/bin/ffmpeg'];
foreach ($paths as $p) {
    if (file_exists($p)) {
        $result['found_at'] = $p;
        break;
    }
}

echo json_encode($result, JSON_PRETTY_PRINT);
