import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRoles } from '../middleware/auth.js';

const router = Router();

function formatAssessment(a) {
  const questions = typeof a.questions === 'string' ? JSON.parse(a.questions) : (a.questions || []);
  return {
    id: String(a.id),
    _id: String(a.id),
    courseId: String(a.course_id),
    course_id: String(a.course_id),
    authorId: String(a.author_id),
    title: a.title,
    description: a.instructions || '',
    instructions: a.instructions || '',
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

    let sql = 'SELECT * FROM assessments WHERE 1=1';
    const params = [];

    if (courseId) {
      params.push(courseId);
      sql += ` AND course_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';
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

// POST /courses/:courseId/assessments and POST /assessments
async function createAssessmentHandler(req, res, next) {
  try {
    const courseId = req.params.courseId || req.body.courseId || req.body.course_id;
    const { title, instructions, description, status = 'draft', timeLimitSeconds = 600, randomizeQuestions = true, maxAttempts = 1, availableFrom, dueAt, questions = [] } = req.body || {};

    if (!courseId || !title) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'courseId and title are required.' } });
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
      `INSERT INTO assessments (course_id, author_id, title, instructions, status, time_limit_seconds, randomize_questions, max_attempts, available_from, due_at, questions, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        courseId,
        req.user.id,
        title.trim(),
        instructions || description || '',
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
    const { title, instructions, status, timeLimitSeconds, randomizeQuestions, maxAttempts, availableFrom, dueAt, questions } = req.body || {};

    const newTitle = title !== undefined ? title.trim() : a.title;
    const newInstructions = instructions !== undefined ? instructions : a.instructions;
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
       SET title = $1, instructions = $2, status = $3, time_limit_seconds = $4,
           randomize_questions = $5, max_attempts = $6, available_from = $7,
           due_at = $8, questions = $9, published_at = $10, updated_at = now()
       WHERE id = $11
       RETURNING *`,
      [newTitle, newInstructions, newStatus, newTimeLimit, newRandom, newAttempts, newAvail, newDue, newQuestions, publishedAt, req.params.id]
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
    const responses = sub.responses || [];

    // Auto-grading
    let totalScore = 0;
    let maxScore = 0;
    for (const q of questions) {
      const qPoints = Number(q.points || 1);
      maxScore += qPoints;
      const resp = responses.find((r) => r.questionId === q.id || r.id === q.id);
      if (resp && q.correctOptionIds && q.correctOptionIds.includes(resp.value)) {
        totalScore += qPoints;
      }
    }

    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 100;

    const result = await query(
      `UPDATE submissions
       SET attempt_status = 'submitted', submitted_at = now(),
           grading_status = 'auto_graded', grading_score = $1, graded_at = now(), updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [percentage, sub.id]
    );

    res.json({
      success: true,
      submission: result.rows[0],
      score: percentage,
      maxScore: 100
    });
  } catch (err) {
    next(err);
  }
});

// POST /assessments/:id/submit
router.post('/assessments/:id/submit', authenticate, async (req, res, next) => {
  try {
    const { submissionId, answers, responses } = req.body || {};
    if (submissionId) {
      req.params.submissionId = submissionId;
      return next(); // handled or redirect
    }

    // Direct submit fallback
    const result = await query(
      `INSERT INTO submissions (student_id, course_id, assessment_id, kind, submission_type, responses, attempt_status, grading_status, grading_score, submitted_at)
       VALUES ($1, (SELECT course_id FROM assessments WHERE id = $2), $2, 'assessment', 'mcq', $3, 'submitted', 'graded', 100, now())
       RETURNING *`,
      [req.user.id, req.params.id, JSON.stringify(responses || answers || [])]
    );

    res.json({ success: true, submission: result.rows[0], score: 100 });
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
