import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRoles } from '../middleware/auth.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCourseId(value) {
  if (value === undefined || value === null || value === '' || /^(general|global)( \(all courses\))?$/i.test(String(value))) return null;
  return UUID_RE.test(String(value)) ? String(value) : undefined;
}

function formatAssessment(a) {
  const questions = typeof a.questions === 'string' ? JSON.parse(a.questions) : (a.questions || []);
  return {
    id: String(a.id),
    _id: String(a.id),
    courseId: a.course_id ? String(a.course_id) : null,
    course_id: a.course_id ? String(a.course_id) : null,
    authorId: String(a.author_id),
    title: a.title,
    description: a.instructions || '',
    instructions: a.instructions || '',
    type: a.type || 'quiz',
    status: a.status,
    is_published: a.status === 'published',
    timeLimitSeconds: a.time_limit_seconds,
    timeLimit: Math.round(a.time_limit_seconds / 60),
    randomizeQuestions: a.randomize_questions,
    maxAttempts: a.max_attempts,
    attempts: a.max_attempts,
    availableFrom: a.available_from,
    startDate: a.available_from,
    dueAt: a.due_at,
    endDate: a.due_at,
    questions: questions.map((q) => ({
      id: q.id,
      text: q.prompt,
      prompt: q.prompt,
      type: q.type,
      options: q.options || [],
      marks: q.points || 1,
      points: q.points || 1,
      rubric: q.rubric || []
    })),
    totalMarks: questions.reduce((acc, q) => acc + (q.points || 1), 0),
    passingGrade: 60,
    publishedAt: a.published_at,
    createdAt: a.created_at,
    updatedAt: a.updated_at
  };
}

// GET /assessments
router.get('/assessments', authenticate, async (req, res, next) => {
  try {
    const courseId = req.query.courseId || req.query.course_id;
    const { status, type } = req.query;

    let sql = 'SELECT a.* FROM assessments a WHERE 1=1';
    const params = [];

    if (req.user.role === 'student') {
      params.push(req.user.id);
      sql += ` AND a.status = 'published' AND (a.course_id IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e
        WHERE e.student_id = $${params.length} AND e.course_id = a.course_id AND e.status IN ('enrolled', 'completed')
      ))`;
    }
    if (courseId) {
      params.push(courseId);
      sql += ` AND a.course_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND a.status = $${params.length}`;
    }
    if (type) {
      params.push(type);
      sql += ` AND a.type = $${params.length}`;
    }

    sql += ' ORDER BY a.created_at DESC';
    const result = await query(sql, params);
    res.json(result.rows.map(formatAssessment));
  } catch (err) {
    next(err);
  }
});

// GET /assessments/student/me
router.get('/assessments/student/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT s.*, a.title as assessment_title, c.title as course_title
       FROM submissions s
       LEFT JOIN assessments a ON a.id = s.assessment_id
       LEFT JOIN courses c ON c.id = s.course_id
       WHERE s.student_id = $1 AND s.kind = 'assessment'
       ORDER BY s.submitted_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/assessments/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'ASSESSMENT_NOT_FOUND', message: 'Assessment not found.' } });
    }

    const assessment = result.rows[0];
    if (req.user.role === 'student') {
      const enrollment = assessment.course_id
        ? await query(
            "SELECT 1 FROM enrollments WHERE student_id = $1 AND course_id = $2 AND status IN ('enrolled', 'completed')",
            [req.user.id, assessment.course_id]
          )
        : { rows: [{}] };
      if (assessment.status !== 'published' || enrollment.rows.length === 0) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This assessment is not available to you.' } });
      }
    } else if (req.user.role === 'instructor' && String(assessment.author_id) !== String(req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to view this assessment.' } });
    }

    res.json(formatAssessment(assessment));
  } catch (err) {
    next(err);
  }
});

// POST /courses/:courseId/assessments and POST /assessments
async function createAssessmentHandler(req, res, next) {
  try {
    const rawCourseId = req.params.courseId || req.body.courseId || req.body.course_id;
    const courseId = normalizeCourseId(rawCourseId);
    const { title, instructions, description, type = 'quiz', status = 'draft', timeLimitSeconds = 600, randomizeQuestions = true, maxAttempts = 1, availableFrom, dueAt, questions = [] } = req.body || {};

    if (!title?.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Title is required.' } });
    }
    if (courseId === undefined) {
      return res.status(400).json({ error: { code: 'INVALID_COURSE', message: 'Select a valid course or General (All Courses).' } });
    }
    if (!['quiz', 'exam', 'assignment', 'task'].includes(type)) {
      return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Assessment type must be quiz, exam, assignment, or task.' } });
    }

    const formattedQuestions = questions.map((q, idx) => ({
      id: q.id || `q-${idx + 1}`,
      type: q.type || 'mcq',
      prompt: q.prompt || q.text || `Question ${idx + 1}`,
      options: q.options || [],
      correctOptionIds: q.correctOptionIds || (q.correctAnswer ? [q.correctAnswer] : []),
      points: Number(q.points || q.marks || 1),
      rubric: q.rubric || []
    }));

    const result = await query(
      `INSERT INTO assessments (course_id, author_id, title, instructions, type, status, time_limit_seconds, randomize_questions, max_attempts, available_from, due_at, questions, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        courseId,
        req.user.id,
        title.trim(),
        instructions || description || '',
        type,
        status,
        timeLimitSeconds,
        randomizeQuestions,
        maxAttempts,
        availableFrom || null,
        dueAt || null,
        JSON.stringify(formattedQuestions),
        status === 'published' ? new Date() : null
      ]
    );

    res.status(201).json(formatAssessment(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

router.post('/courses/:courseId/assessments', authenticate, requireRoles('instructor', 'admin'), createAssessmentHandler);
router.post('/assessments', authenticate, requireRoles('instructor', 'admin'), createAssessmentHandler);

// PATCH /assessments/:id and PUT /assessments/:id
async function updateAssessmentHandler(req, res, next) {
  try {
    const existing = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { code: 'ASSESSMENT_NOT_FOUND', message: 'Assessment not found.' } });
    }

    const a = existing.rows[0];
    const { title, instructions, type, status, timeLimitSeconds, randomizeQuestions, maxAttempts, availableFrom, dueAt, questions } = req.body || {};
    if (type !== undefined && !['quiz', 'exam', 'assignment', 'task'].includes(type)) {
      return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Assessment type must be quiz, exam, assignment, or task.' } });
    }

    const newTitle = title !== undefined ? title.trim() : a.title;
    const newInstructions = instructions !== undefined ? instructions : a.instructions;
    const newType = type !== undefined ? type : a.type;
    const newStatus = status !== undefined ? status : a.status;
    const newTimeLimit = timeLimitSeconds !== undefined ? timeLimitSeconds : a.time_limit_seconds;
    const newRandom = randomizeQuestions !== undefined ? randomizeQuestions : a.randomize_questions;
    const newAttempts = maxAttempts !== undefined ? maxAttempts : a.max_attempts;
    const newAvail = availableFrom !== undefined ? availableFrom : a.available_from;
    const newDue = dueAt !== undefined ? dueAt : a.due_at;
    const newQuestions = questions !== undefined ? JSON.stringify(questions) : a.questions;
    const publishedAt = newStatus === 'published' && !a.published_at ? new Date() : a.published_at;

    const result = await query(
      `UPDATE assessments
       SET title = $1, instructions = $2, type = $3, status = $4, time_limit_seconds = $5,
           randomize_questions = $6, max_attempts = $7, available_from = $8,
           due_at = $9, questions = $10, published_at = $11, updated_at = now()
       WHERE id = $12
       RETURNING *`,
      [newTitle, newInstructions, newType, newStatus, newTimeLimit, newRandom, newAttempts, newAvail, newDue, newQuestions, publishedAt, req.params.id]
    );

    res.json(formatAssessment(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

router.patch('/assessments/:id', authenticate, requireRoles('instructor', 'admin'), updateAssessmentHandler);
router.put('/assessments/:id', authenticate, requireRoles('instructor', 'admin'), updateAssessmentHandler);

// POST /assessments/:id/publish & PATCH /assessments/:id/publish
async function publishAssessmentHandler(req, res, next) {
  try {
    const result = await query(
      `UPDATE assessments
       SET status = 'published', published_at = COALESCE(published_at, now()), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'ASSESSMENT_NOT_FOUND', message: 'Assessment not found.' } });
    }
    res.json(formatAssessment(result.rows[0]));
  } catch (err) {
    next(err);
  }
}
router.post('/assessments/:id/publish', authenticate, requireRoles('instructor', 'admin'), publishAssessmentHandler);
router.patch('/assessments/:id/publish', authenticate, requireRoles('instructor', 'admin'), publishAssessmentHandler);

// DELETE /assessments/:id
router.delete('/assessments/:id', authenticate, requireRoles('instructor', 'admin'), async (req, res, next) => {
  try {
    await query('DELETE FROM assessments WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Assessment deleted.' });
  } catch (err) {
    next(err);
  }
});

// POST /assessments/:id/start (start attempt)
router.post('/assessments/:id/start', authenticate, async (req, res, next) => {
  try {
    const assessRes = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    if (assessRes.rows.length === 0) {
      return res.status(404).json({ error: { code: 'ASSESSMENT_NOT_FOUND', message: 'Assessment not found.' } });
    }

    const a = assessRes.rows[0];
    const now = new Date();

    // 1. Check due_at FIRST before max_attempts
    if (a.due_at && now > new Date(a.due_at)) {
      return res.status(400).json({
        error: {
          code: 'ASSESSMENT_PAST_DUE',
          message: 'Assessment deadline has passed. No new attempts are permitted.'
        }
      });
    }

    if (a.available_from && now < new Date(a.available_from)) {
      return res.status(400).json({
        error: {
          code: 'ASSESSMENT_NOT_YET_AVAILABLE',
          message: 'Assessment is not yet available.'
        }
      });
    }

    // 2. Check max_attempts SECOND
    const prevAttempts = await query(
      'SELECT COUNT(*) as count FROM submissions WHERE student_id = $1 AND assessment_id = $2',
      [req.user.id, a.id]
    );

    const attemptNumber = Number(prevAttempts.rows[0].count) + 1;
    if (attemptNumber > a.max_attempts) {
      return res.status(400).json({ error: { code: 'MAX_ATTEMPTS_EXCEEDED', message: 'Maximum attempts reached for this assessment.' } });
    }
    const expiresAt = new Date(now.getTime() + a.time_limit_seconds * 1000);
    const questions = typeof a.questions === 'string' ? JSON.parse(a.questions) : a.questions;

    const result = await query(
      `INSERT INTO submissions (student_id, course_id, assessment_id, kind, attempt_number, submission_type, responses, started_at, expires_at, attempt_status, question_snapshot)
       VALUES ($1, $2, $3, 'assessment', $4, 'mcq', '[]'::jsonb, $5, $6, 'in_progress', $7)
       RETURNING *`,
      [req.user.id, a.course_id, a.id, attemptNumber, now, expiresAt, JSON.stringify(questions)]
    );

    const submission = result.rows[0];
    res.status(201).json({
      id: String(submission.id),
      submissionId: String(submission.id),
      assessmentId: String(a.id),
      attemptNumber,
      startedAt: submission.started_at,
      expiresAt: submission.expires_at,
      questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, type: q.type, options: q.options, points: q.points }))
    });
  } catch (err) {
    next(err);
  }
});

// GET /attempts/:submissionId
router.get('/attempts/:submissionId', authenticate, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM submissions WHERE id = $1', [req.params.submissionId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'ATTEMPT_NOT_FOUND', message: 'Attempt not found.' } });
    }
    const sub = result.rows[0];
    res.json({
      id: String(sub.id),
      submissionId: String(sub.id),
      assessmentId: String(sub.assessment_id),
      attemptStatus: sub.attempt_status,
      responses: sub.responses || [],
      score: sub.grading_score,
      gradingStatus: sub.grading_status,
      startedAt: sub.started_at,
      expiresAt: sub.expires_at,
      submittedAt: sub.submitted_at
    });
  } catch (err) {
    next(err);
  }
});

// PUT /attempts/:submissionId/answers
router.put('/attempts/:submissionId/answers', authenticate, async (req, res, next) => {
  try {
    const { responses } = req.body || {};
    const result = await query(
      `UPDATE submissions
       SET responses = $1, updated_at = now()
       WHERE id = $2 AND student_id = $3 AND attempt_status = 'in_progress'
       RETURNING *`,
      [JSON.stringify(responses || []), req.params.submissionId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'ATTEMPT_NOT_FOUND', message: 'Active attempt not found.' } });
    }
    res.json({ success: true, responses: result.rows[0].responses });
  } catch (err) {
    next(err);
  }
});

// POST /attempts/:submissionId/submit
router.post('/attempts/:submissionId/submit', authenticate, async (req, res, next) => {
  try {
    const subRes = await query('SELECT * FROM submissions WHERE id = $1 AND student_id = $2', [req.params.submissionId, req.user.id]);
    if (subRes.rows.length === 0) {
      return res.status(404).json({ error: { code: 'ATTEMPT_NOT_FOUND', message: 'Attempt not found.' } });
    }

    const sub = subRes.rows[0];
    const questions = sub.question_snapshot || [];
    const storedResponses = sub.responses || [];
    const incoming = Array.isArray(req.body?.responses) ? req.body.responses : storedResponses;

    const grade = gradeResponses(questions, incoming);
    const hasContent = grade.answered > 0;
    const isAutoGradable = questions.length > 0 && questions.every((q) => q.correctOptionIds || q.correctIndex !== undefined);
    const gradingStatus = !hasContent ? 'pending' : (isAutoGradable ? 'auto_graded' : 'manual_review');
    const gradingScore = hasContent && isAutoGradable ? grade.percentage : null;

    const result = await query(
      `UPDATE submissions
       SET responses = $1, attempt_status = 'submitted', submitted_at = now(),
           grading_status = $2, grading_score = $3,
           graded_at = CASE WHEN $2 = 'auto_graded' THEN now() ELSE graded_at END, updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [JSON.stringify(incoming), gradingStatus, gradingScore, sub.id]
    );

    res.json({
      success: true,
      submission: result.rows[0],
      score: gradingScore,
      maxScore: grade.possible
    });
  } catch (err) {
    next(err);
  }
});

// Auto-grade a set of responses against an assessment's questions.
function gradeResponses(questions, responses) {
  const qs = Array.isArray(questions) ? questions : [];
  const rs = Array.isArray(responses) ? responses : [];
  if (qs.length === 0) return { percentage: null, earned: 0, possible: 0, answered: rs.length };

  let earned = 0;
  let possible = 0;
  let answered = 0;
  for (const q of qs) {
    const pts = Number(q.points || 1);
    possible += pts;
    const resp = rs.find((r) => (r.questionId || r.id) === q.id);
    if (!resp) continue;
    const value = resp.value !== undefined ? resp.value : resp.answer;
    if (value === undefined || value === null || value === '') continue;
    answered += 1;
    const correct = q.correctOptionIds || (q.correctIndex !== undefined ? [q.correctIndex] : null);
    if (correct && correct.length && correct.includes(value)) earned += pts;
  }

  return {
    percentage: possible > 0 ? Math.round((earned / possible) * 100) : 0,
    earned,
    possible,
    answered
  };
}

// POST /assessments/:id/submit
router.post('/assessments/:id/submit', authenticate, async (req, res, next) => {
  try {
    const { submissionId, answers, responses, files } = req.body || {};
    const provided = responses || answers || [];

    const assessRes = await query('SELECT * FROM assessments WHERE id = $1', [req.params.id]);
    if (assessRes.rows.length === 0) {
      return res.status(404).json({ error: { code: 'ASSESSMENT_NOT_FOUND', message: 'Assessment not found.' } });
    }
    const a = assessRes.rows[0];
    const questions = typeof a.questions === 'string' ? JSON.parse(a.questions) : (a.questions || []);

    if (submissionId) {
      const subRes = await query('SELECT * FROM submissions WHERE id = $1 AND student_id = $2', [submissionId, req.user.id]);
      if (subRes.rows.length === 0) {
        return res.status(404).json({ error: { code: 'ATTEMPT_NOT_FOUND', message: 'Attempt not found.' } });
      }
      const sub = subRes.rows[0];
      const snapshot = sub.question_snapshot || questions;
      const merged = Array.isArray(provided) && provided.length ? provided : (sub.responses || []);
      const grade = gradeResponses(snapshot, merged);
      const result = await query(
        `UPDATE submissions
         SET responses = $1, attempt_status = 'submitted', submitted_at = now(),
             grading_status = $2, grading_score = $3, graded_at = now(), updated_at = now()
         WHERE id = $4
         RETURNING *`,
        [JSON.stringify(merged), grade.answered ? 'auto_graded' : 'pending', grade.answered ? grade.percentage : null, sub.id]
      );
      return res.json({ success: true, submission: result.rows[0], score: grade.answered ? grade.percentage : null });
    }

    // Direct submit: grade against the stored answer key. No answers => no score.
    const grade = gradeResponses(questions, provided);
    const hasContent = grade.answered > 0 || (Array.isArray(files) && files.length > 0);
    const isAutoGradable = questions.length > 0 && questions.every((q) => q.correctOptionIds || q.correctIndex !== undefined);
    const gradingStatus = !hasContent ? 'pending' : (isAutoGradable ? 'auto_graded' : 'manual_review');
    const gradingScore = hasContent && isAutoGradable ? grade.percentage : null;

    const result = await query(
      `INSERT INTO submissions (student_id, course_id, assessment_id, kind, submission_type, responses, attempt_status, grading_status, grading_score, submitted_at, graded_at)
       VALUES ($1, $2, $3, 'assessment', 'mcq', $4, 'submitted', $5, $6, now(), $7)
       RETURNING *`,
      [req.user.id, a.course_id, req.params.id, JSON.stringify(provided), gradingStatus, gradingScore, gradingStatus === 'auto_graded' ? new Date() : null]
    );

    res.json({ success: true, submission: result.rows[0], score: gradingScore });
  } catch (err) {
    next(err);
  }
});

// GET /assessments/:id/submissions
router.get('/assessments/:id/submissions', authenticate, requireRoles('instructor', 'admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT s.*, u.name as student_name, u.email as student_email
       FROM submissions s
       JOIN users u ON u.id = s.student_id
       WHERE s.assessment_id = $1
       ORDER BY s.submitted_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /courses/:courseId/grading-queue
router.get('/courses/:courseId/grading-queue', authenticate, requireRoles('instructor', 'admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT s.*, u.name as student_name, a.title as assessment_title
       FROM submissions s
       JOIN users u ON u.id = s.student_id
       LEFT JOIN assessments a ON a.id = s.assessment_id
       WHERE s.course_id = $1 AND s.attempt_status = 'submitted'
       ORDER BY s.submitted_at ASC`,
      [req.params.courseId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /attempts/:submissionId/grade
router.patch('/attempts/:submissionId/grade', authenticate, requireRoles('instructor', 'admin'), async (req, res, next) => {
  try {
    const { score, feedback } = req.body || {};
    const result = await query(
      `UPDATE submissions
       SET grading_score = $1, grading_feedback = $2, grading_status = 'graded',
           graded_by = $3, graded_at = now(), updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [score, feedback || null, req.user.id, req.params.submissionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submission not found.' } });
    }

    const sub = result.rows[0];
    const dedupKey = `submission_graded:${sub.id}`;
    await query(
      `INSERT INTO notifications (recipient_id, type, payload, deduplication_key)
       VALUES ($1, 'assessment_graded', $2, $3)
       ON CONFLICT (recipient_id, deduplication_key) WHERE deduplication_key IS NOT NULL
       DO NOTHING`,
      [
        sub.student_id,
        JSON.stringify({ submissionId: String(sub.id), assessmentId: String(sub.assessment_id), score: sub.grading_score }),
        dedupKey
      ]
    );

    res.json(sub);
  } catch (err) {
    next(err);
  }
});

export default router;
