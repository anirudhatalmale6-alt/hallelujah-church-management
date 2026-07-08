<?php
/**
 * Copy this file to config.secret.php on the SERVER ONLY and set a strong random
 * value. config.secret.php is git-ignored so the real key never reaches GitHub.
 * Generate one with:  php -r "echo bin2hex(random_bytes(48));"
 */
define('HITC_JWT_SECRET', 'REPLACE-WITH-A-LONG-RANDOM-VALUE');
