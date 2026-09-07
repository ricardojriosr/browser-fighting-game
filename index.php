<?php
declare(strict_types=1);

/*
 * PHP es opcional. Este archivo permite abrir el juego en servidores
 * que priorizan index.php. El juego real sigue siendo HTML/JavaScript.
 */
header('Content-Type: text/html; charset=UTF-8');
readfile(__DIR__ . '/index.html');
