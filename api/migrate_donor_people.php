<?php
/**
 * One-off: backfill the People list from existing non-member donors.
 *
 * For every donation that has a donor_name but no member_id (and whose name
 * is NOT a known expense vendor / business), create a People record and link
 * the donation(s) to it. Businesses like "Amazon" are left as donor_name.
 *
 * Run once:  /system/api/migrate_donor_people.php?key=hitc-donor-people-2026
 * Remove from server afterwards.
 */
require __DIR__ . '/config.php';
header('Content-Type: application/json');

if (($_GET['key'] ?? '') !== 'hitc-donor-people-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

$db = getDB();
$out = ['created' => [], 'linked' => [], 'skipped_vendor' => [], 'errors' => []];

// Distinct named donors that aren't linked to a member yet
$donors = $db->query("
    SELECT TRIM(donor_name) as donor_name, COUNT(*) as gifts
    FROM donations
    WHERE member_id IS NULL AND donor_name IS NOT NULL AND TRIM(donor_name) <> ''
    GROUP BY TRIM(donor_name)
    ORDER BY donor_name
")->fetchAll();

$vendorCheck = $db->prepare("SELECT 1 FROM expenses WHERE LOWER(TRIM(vendor)) = LOWER(?) LIMIT 1");
$memberByName = $db->prepare("SELECT id FROM members WHERE LOWER(TRIM(CONCAT(first_name,' ',last_name))) = LOWER(?) ORDER BY id ASC LIMIT 1");
$insMember = $db->prepare("
    INSERT INTO members (first_name, last_name, person_type, status, import_source, notes)
    VALUES (?, ?, 'non_member_attendee', 'active', 'donation', 'Auto-added from a recorded donation')
");
$linkDonations = $db->prepare("
    UPDATE donations SET member_id = ?, donor_name = NULL
    WHERE member_id IS NULL AND LOWER(TRIM(donor_name)) = LOWER(?)
");

foreach ($donors as $d) {
    $name = $d['donor_name'];
    try {
        // Skip businesses / expense vendors
        $vendorCheck->execute([$name]);
        if ($vendorCheck->fetchColumn()) { $out['skipped_vendor'][] = $name; continue; }

        // Reuse existing person of same name, else create
        $memberByName->execute([$name]);
        $memberId = $memberByName->fetchColumn();
        if (!$memberId) {
            $parts = preg_split('/\s+/', $name, 2);
            $insMember->execute([$parts[0], $parts[1] ?? '']);
            $memberId = (int)$db->lastInsertId();
            $out['created'][] = ['name' => $name, 'member_id' => $memberId];
        }

        $linkDonations->execute([$memberId, $name]);
        $out['linked'][] = ['name' => $name, 'member_id' => (int)$memberId, 'gifts' => (int)$d['gifts']];
    } catch (Exception $e) {
        $out['errors'][] = ['name' => $name, 'error' => $e->getMessage()];
    }
}

echo json_encode($out, JSON_PRETTY_PRINT);
