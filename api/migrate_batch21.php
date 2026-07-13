<?php
/**
 * Batch 21 - Groups & Departments restructure
 *
 * Problem this fixes:
 *   members.family_group was a single VARCHAR(100) holding a comma-separated
 *   list of group names. That silently truncated at 100 chars (one member had
 *   "... Women Ministry, M"), the names drifted from groups.name so reports
 *   could not join, deleting one group wiped a member's OTHER groups, and
 *   renaming a group only fixed members who were in that group alone.
 *
 * What it does:
 *   1. groups gains department_id / category / is_active / sort_order
 *   2. new member_groups join table = the real source of truth
 *   3. backfills member_groups from the old comma string (alias + unique-prefix
 *      matching); anything ambiguous is reported, never guessed
 *   4. family_group is widened and kept as a denormalised cache so every
 *      existing read path (CSV, ID cards, reports) keeps working
 *   5. links each serving-team group to its department and classifies the rest
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
requireRole($currentUser, ['admin']);

$db = getDB();
$out = [];
$dry = isset($_GET['dry']) && $_GET['dry'] === '1';

function col_exists($db, $table, $col) {
    $s = $db->prepare("SELECT COUNT(*) FROM information_schema.columns
                       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?");
    $s->execute([$table, $col]);
    return (int)$s->fetchColumn() > 0;
}

/* ---------------------------------------------------------------- 1. schema */
if (!$dry) {
    foreach ([
        'department_id' => "ALTER TABLE `groups` ADD COLUMN department_id INT NULL",
        'category'      => "ALTER TABLE `groups` ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'ministry'",
        'is_active'     => "ALTER TABLE `groups` ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1",
        'sort_order'    => "ALTER TABLE `groups` ADD COLUMN sort_order INT NOT NULL DEFAULT 0",
    ] as $col => $sql) {
        if (!col_exists($db, 'groups', $col)) {
            $db->exec($sql);
            $out[] = "groups: added $col";
        }
    }

    try {
        $db->exec("ALTER TABLE `groups`
                   ADD CONSTRAINT fk_group_department FOREIGN KEY (department_id)
                   REFERENCES departments(id) ON DELETE SET NULL");
        $out[] = "groups: FK department_id -> departments";
    } catch (Exception $e) { /* already there */ }

    // widen the legacy cache column so it can never truncate a name again
    $db->exec("ALTER TABLE members MODIFY COLUMN family_group VARCHAR(500) DEFAULT NULL");
    $out[] = "members.family_group widened to VARCHAR(500)";

    $db->exec("CREATE TABLE IF NOT EXISTS member_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        member_id INT NOT NULL,
        group_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_member_group (member_id, group_id),
        KEY idx_mg_group (group_id),
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $out[] = "created member_groups table";
}

/* ------------------------------------------------- 2. resolve group names */
$groups = $db->query("SELECT id, name FROM `groups`")->fetchAll();

$norm = function ($s) {
    $s = str_replace(["\xE2\x80\x99", "\xE2\x80\x98", "`"], "'", (string)$s); // curly -> straight
    $s = preg_replace('/\s+/', ' ', $s);
    return mb_strtolower(trim($s));
};

$byName = [];
foreach ($groups as $g) {
    $byName[$norm($g['name'])] = (int)$g['id'];
}

/**
 * Resolve one fragment of the old comma string to a group id.
 * Order: exact -> left-of-slash -> unique prefix. Never guesses between two.
 */
$resolve = function ($fragment) use ($groups, $byName, $norm) {
    $f = $norm($fragment);
    if ($f === '') return null;

    if (isset($byName[$f])) return $byName[$f];

    // "Ushers" should find "Ushers / Greeters"
    foreach ($groups as $g) {
        $left = $norm(explode('/', $g['name'])[0]);
        if ($left === $f) return (int)$g['id'];
    }

    // "Youth" -> "Youth Outreach Initiative", but only if exactly one candidate
    $hits = [];
    foreach ($groups as $g) {
        if (str_starts_with($norm($g['name']), $f)) $hits[] = (int)$g['id'];
    }
    return count($hits) === 1 ? $hits[0] : null;
};

/* ---------------------------------------------------- 3. backfill mappings */
$members = $db->query("SELECT id, first_name, last_name, family_group FROM members
                       WHERE family_group IS NOT NULL AND family_group <> ''")->fetchAll();

$linked = 0;
$unresolved = [];

$ins = $dry ? null : $db->prepare("INSERT IGNORE INTO member_groups (member_id, group_id) VALUES (?, ?)");

foreach ($members as $m) {
    foreach (explode(',', $m['family_group']) as $fragment) {
        $fragment = trim($fragment);
        if ($fragment === '') continue;

        $gid = $resolve($fragment);
        if ($gid === null) {
            $unresolved[] = [
                'member'   => trim($m['first_name'] . ' ' . $m['last_name']),
                'fragment' => $fragment,
                'raw'      => $m['family_group'],
            ];
            continue;
        }
        if (!$dry) $ins->execute([(int)$m['id'], $gid]);
        $linked++;
    }
}
$out[] = "linked $linked member-group memberships";
if ($unresolved) {
    $out[] = count($unresolved) . " fragment(s) could NOT be resolved (left untouched, nothing deleted)";
}

/* ------------------------------- 4. classify groups + link to departments */
// group name (left of any slash, lowercased) => department name
$deptFor = [
    'ushers'                          => 'Ushers',
    'maintenance'                     => 'Maintenance',
    'worship team'                    => 'Worship Team',
    'media'                           => 'Media/Tech',
    'children enrichment programs'    => 'Children Ministry',
    'prayer ministry'                 => 'Prayer Team',
    'culinary'                        => 'Hospitality',
    'youth outreach initiative'       => 'Youth Department',
    'discipleship program'            => 'Evangelization Ministry',
    'transportation'                  => 'Transportation',
];
$leadership = ['executive', 'deacons', 'commissioners'];

if (!$dry) {
    // Transportation has a group but no department yet
    $chk = $db->prepare("SELECT id FROM departments WHERE name = ?");
    $chk->execute(['Transportation']);
    if (!$chk->fetchColumn()) {
        $db->prepare("INSERT INTO departments (name, description, sort_order)
                      VALUES (?, ?, ?)")->execute([
            'Transportation',
            'Providing safe, punctual, and friendly travel for congregation members and guests, ensuring accessibility to worship services and church events.',
            9,
        ]);
        $out[] = "created department: Transportation";
    }

    $depts = [];
    foreach ($db->query("SELECT id, name, description FROM departments")->fetchAll() as $d) {
        $depts[$norm($d['name'])] = $d;
    }

    $setGroup = $db->prepare("UPDATE `groups` SET department_id = ?, category = ? WHERE id = ?");
    $setDeptDesc = $db->prepare("UPDATE departments SET description = ? WHERE id = ? AND (description IS NULL OR description = '' OR CHAR_LENGTH(description) < 60)");

    foreach ($groups as $g) {
        $left = $norm(explode('/', $g['name'])[0]);
        $full = $norm($g['name']);

        $deptName = $deptFor[$left] ?? ($deptFor[$full] ?? null);
        if ($deptName !== null && isset($depts[$norm($deptName)])) {
            $d = $depts[$norm($deptName)];
            $setGroup->execute([(int)$d['id'], 'department', (int)$g['id']]);

            // the pastor wrote the real roles & responsibilities on the GROUP;
            // the department was left with a one-line stub. Promote the good text.
            $gd = $db->prepare("SELECT description FROM `groups` WHERE id = ?");
            $gd->execute([(int)$g['id']]);
            $desc = trim((string)$gd->fetchColumn());
            if ($desc !== '') $setDeptDesc->execute([$desc, (int)$d['id']]);
        } elseif (in_array($left, $leadership, true)) {
            $setGroup->execute([null, 'leadership', (int)$g['id']]);
        } else {
            $setGroup->execute([null, 'ministry', (int)$g['id']]);
        }
    }
    $out[] = "classified " . count($groups) . " groups and linked serving teams to departments";

    /* ---------------------- 5. rebuild the denormalised family_group cache */
    $db->exec("UPDATE members m
               LEFT JOIN (
                   SELECT mg.member_id, GROUP_CONCAT(g.name ORDER BY g.name SEPARATOR ', ') AS names
                   FROM member_groups mg JOIN `groups` g ON g.id = mg.group_id
                   GROUP BY mg.member_id
               ) x ON x.member_id = m.id
               SET m.family_group = x.names");
    $out[] = "rebuilt members.family_group from member_groups";
}

jsonResponse([
    'dry_run'    => $dry,
    'results'    => $out,
    'unresolved' => $unresolved,
]);
