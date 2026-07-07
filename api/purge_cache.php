<?php
header('Content-Type: application/json');

// Purge LiteSpeed cache via PURGE request
$urls = [
    'https://hallelujahinthecity.org/system/public/',
    'https://hallelujahinthecity.org/system/public/index.html',
    'https://hallelujahinthecity.org/system/',
];

$results = [];

// Method 1: Send PURGE requests
foreach ($urls as $url) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PURGE');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $results[] = "PURGE $url: HTTP $code";
}

// Method 2: Touch the htaccess files to invalidate LiteSpeed cache
$systemDir = dirname(__DIR__);
$files = [
    $systemDir . '/.htaccess',
    $systemDir . '/public/.htaccess',
    $systemDir . '/public/index.html',
];

foreach ($files as $file) {
    if (file_exists($file)) {
        touch($file);
        clearstatcache(true, $file);
        $results[] = "Touched: $file (" . filemtime($file) . ")";
    } else {
        $results[] = "Not found: $file";
    }
}

// Method 3: OPcache invalidation
if (function_exists('opcache_reset')) {
    opcache_reset();
    $results[] = 'OPcache reset';
} else {
    $results[] = 'OPcache reset not available';
}

echo json_encode(['results' => $results, 'time' => date('Y-m-d H:i:s')]);
