<?php
/**
 * Batch 22 - Typed notes in Documents
 *
 * The pastor wanted to be able to type a note (a sermon, a policy) straight into
 * the system instead of only uploading a file that was written somewhere else.
 *
 * Rather than a second, parallel list of "notes" with its own search, categories
 * and folder permissions, a note is just a document that happens to have been
 * typed here. So it lives in the same table and inherits everything already built
 * around it: category cards, search, folder-level access, delete, print.
 *
 * Two columns:
 *   is_note      - 1 marks it as typed-here, so the screen offers Edit instead of
 *                  only Download, and shows the text in a reader.
 *   note_content - the text itself, kept in the database so it stays editable.
 *                  A plain .txt copy is also written to uploads/documents so
 *                  Download still hands the reader a real file.
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
requireRole($currentUser, ['admin', 'pastor']);

$db = getDB();
$out = [];

function col_exists22($db, $table, $col) {
    $s = $db->prepare("SELECT COUNT(*) FROM information_schema.columns
                       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?");
    $s->execute([$table, $col]);
    return (int)$s->fetchColumn() > 0;
}

foreach ([
    'is_note'      => "ALTER TABLE documents ADD COLUMN is_note TINYINT(1) NOT NULL DEFAULT 0",
    'note_content' => "ALTER TABLE documents ADD COLUMN note_content MEDIUMTEXT NULL",
] as $col => $sql) {
    if (col_exists22($db, 'documents', $col)) {
        $out[] = "documents.$col already present - skipped";
        continue;
    }
    try {
        $db->exec($sql);
        $out[] = "documents.$col added";
    } catch (Exception $e) {
        $out[] = "documents.$col FAILED: " . $e->getMessage();
    }
}

jsonResponse(['message' => 'Batch 22 complete', 'steps' => $out]);
