<?php
/**
 * Moves business entries that were mistakenly created as People into the
 * Vendors registry.
 *
 * The pastor recorded a few businesses (HC Store, HC Ressource Center, ...) as
 * "people" while testing. This:
 *   1. registers each one as a vendor (if not already there),
 *   2. keeps any money records they have - the donation stays, but is turned
 *      into a name-only record (member_id cleared, donor_name = business name)
 *      so nothing is lost and it still shows on the vendor statement,
 *   3. removes the person record so it no longer clutters the People list.
 *
 * Safe to run more than once (already-moved names are skipped).
 *
 * Run once:  /system/api/cleanup_business_people.php?key=hitc-move-biz-2026
 */

require_once __DIR__ . '/config.php';

if (($_GET['key'] ?? '') !== 'hitc-move-biz-2026') {
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: text/plain');
$db = getDB();

// The specific person-records to move into Vendors (confirmed test entries).
$targetIds = [124, 125, 127];

$out = [];

$findMember = $db->prepare("SELECT id, TRIM(CONCAT(COALESCE(first_name,''),' ',COALESCE(last_name,''))) AS full_name FROM members WHERE id = ?");
$vendorExists = $db->prepare("SELECT 1 FROM vendors WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1");
$vendorInsert = $db->prepare("INSERT INTO vendors (name, is_active, created_at) VALUES (?, 1, NOW())");
$detachDonations = $db->prepare("UPDATE donations SET member_id = NULL, donor_name = COALESCE(NULLIF(TRIM(donor_name),''), ?) WHERE member_id = ?");
$deleteMember = $db->prepare("DELETE FROM members WHERE id = ?");

foreach ($targetIds as $id) {
    try {
        $db->beginTransaction();

        $findMember->execute([$id]);
        $m = $findMember->fetch();
        if (!$m) {
            $db->rollBack();
            $out[] = "id $id: not found (already moved or never existed) - skipped";
            continue;
        }
        $name = trim($m['full_name']);
        if ($name === '') {
            $db->rollBack();
            $out[] = "id $id: blank name - skipped";
            continue;
        }

        // 1. Register as vendor if not already present.
        $vendorExists->execute([$name]);
        if ($vendorExists->fetchColumn()) {
            $out[] = "id $id ($name): already a vendor";
        } else {
            $vendorInsert->execute([$name]);
            $out[] = "id $id ($name): registered as vendor";
        }

        // 2. Keep any money records - detach from the person, attribute to the name.
        $detachDonations->execute([$name, $id]);
        $moved = $detachDonations->rowCount();
        if ($moved > 0) $out[] = "  - kept $moved donation(s) under the name \"$name\"";

        // 3. Remove the person record.
        $deleteMember->execute([$id]);
        $out[] = "  - removed person record #$id";

        $db->commit();
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        $out[] = "id $id: ERROR - " . $e->getMessage();
    }
}

echo implode("\n", $out) . "\n\nDone.\n";
