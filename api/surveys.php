<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

// Public response endpoint (no auth needed)
if ($action === 'respond' && $method === 'POST') {
    $data = getRequestBody();
    if (empty($data['survey_id']) || empty($data['answers'])) {
        jsonResponse(['error' => 'survey_id and answers required'], 400);
    }
    $survey = $db->prepare("SELECT * FROM surveys WHERE id = ? AND status = 'active'");
    $survey->execute([(int)$data['survey_id']]);
    if (!$survey->fetch()) jsonResponse(['error' => 'Survey not found or closed'], 404);

    $stmt = $db->prepare("INSERT INTO survey_responses (survey_id, member_id, respondent_name, answers) VALUES (?, ?, ?, ?)");
    $stmt->execute([
        (int)$data['survey_id'],
        !empty($data['member_id']) ? (int)$data['member_id'] : null,
        $data['respondent_name'] ?? 'Anonymous',
        json_encode($data['answers']),
    ]);
    jsonResponse(['message' => 'Response submitted'], 201);
}

// Public survey view (no auth)
if ($action === 'public' && $method === 'GET') {
    if (!$id) jsonResponse(['error' => 'Survey ID required'], 400);
    $stmt = $db->prepare("SELECT id, title, description, questions, status FROM surveys WHERE id = ?");
    $stmt->execute([$id]);
    $survey = $stmt->fetch();
    if (!$survey || $survey['status'] !== 'active') jsonResponse(['error' => 'Survey not found or closed'], 404);
    $survey['questions'] = json_decode($survey['questions'], true);
    jsonResponse(['survey' => $survey]);
}

$currentUser = authenticate();

switch ($method) {
    case 'GET':
        if ($action === 'responses' && $id) {
            $stmt = $db->prepare("SELECT sr.*, m.first_name, m.last_name FROM survey_responses sr LEFT JOIN members m ON m.id = sr.member_id WHERE sr.survey_id = ? ORDER BY sr.created_at DESC");
            $stmt->execute([$id]);
            $responses = $stmt->fetchAll();
            foreach ($responses as &$r) { $r['answers'] = json_decode($r['answers'], true); }
            unset($r);
            jsonResponse(['responses' => $responses]);
        }

        $stmt = $db->query("SELECT s.*, u.name as created_by_name, (SELECT COUNT(*) FROM survey_responses sr WHERE sr.survey_id = s.id) as response_count FROM surveys s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.created_at DESC");
        $surveys = $stmt->fetchAll();
        foreach ($surveys as &$s) { $s['questions'] = json_decode($s['questions'], true); }
        unset($s);
        jsonResponse(['surveys' => $surveys]);
        break;

    case 'POST':
        $data = getRequestBody();
        if (empty($data['title']) || empty($data['questions'])) {
            jsonResponse(['error' => 'Title and questions required'], 400);
        }
        $stmt = $db->prepare("INSERT INTO surveys (title, description, questions, status, created_by) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([
            $data['title'],
            $data['description'] ?? null,
            json_encode($data['questions']),
            $data['status'] ?? 'draft',
            $currentUser['user_id'],
        ]);
        jsonResponse(['message' => 'Survey created', 'id' => (int)$db->lastInsertId()], 201);
        break;

    case 'PUT':
        if (!$id) jsonResponse(['error' => 'Survey ID required'], 400);
        $data = getRequestBody();
        $fields = [];
        $params = [];
        if (isset($data['title'])) { $fields[] = 'title = ?'; $params[] = $data['title']; }
        if (isset($data['description'])) { $fields[] = 'description = ?'; $params[] = $data['description']; }
        if (isset($data['questions'])) { $fields[] = 'questions = ?'; $params[] = json_encode($data['questions']); }
        if (isset($data['status'])) {
            $fields[] = 'status = ?'; $params[] = $data['status'];
            if ($data['status'] === 'closed') { $fields[] = 'closed_at = NOW()'; }
        }
        if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $db->prepare("UPDATE surveys SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
        jsonResponse(['message' => 'Survey updated']);
        break;

    case 'DELETE':
        if (!$id) jsonResponse(['error' => 'Survey ID required'], 400);
        $db->prepare("DELETE FROM surveys WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Survey deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
