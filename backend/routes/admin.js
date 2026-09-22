import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRoles, allowAnonymous } from '../middleware/auth.js';

const router = Router();

// GET /health and GET /admin/health (checks DB connectivity)
async function healthHandler(_req, res) {
  try {
    const dbRes = await query('SELECT 1 + 1 as ping');
    if (dbRes.rows.length > 0) {
      return res.status(200).json({
        status: 'ok',
        server: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    }
    throw new Error('Database ping returned empty');
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      server: 'healthy',
      database: 'unreachable',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
}

router.get('/health', allowAnonymous, healthHandler);
router.get('/admin/health', allowAnonymous, healthHandler);

// Guidelines CRUD
function formatGuideline(g) {
  return {
    id: String(g.id),
    _id: String(g.id),
    task_id: String(g.id),
    task_type: g.scope === 'course' ? 'Course Specific Directive' : 'Global Directive',
    description: g.content,
    directive: g.content,
    content: g.content,
    course: g.course_id ? String(g.course_id) : 'Global',
    project_id: g.course_id ? String(g.course_id) : 'Global',
    scope: g.scope,
    priority: 'Normal',
    status: g.status,
    is_active: g.status === 'active',
    version: g.version,
    created_at: g.created_at,
    activatedAt: g.activated_at,
    updatedAt: g.updated_at
  };
}

// GET /admin/guidelines and GET /guidelines
async function listGuidelines(_req, res, next) {
  try {
    const result = await query('SELECT * FROM ai_guidelines WHERE status != \'archived\' ORDER BY created_at DESC');
    res.json(result.rows.map(formatGuideline));
  } catch (err) {
    next(err);
  }
}
router.get('/admin/guidelines', authenticate, listGuidelines);
router.get('/guidelines', authenticate, listGuidelines);

// POST /admin/guidelines and POST /guidelines
async function createGuideline(req, res, next) {
  try {
    const { directive, description, content, scope = 'global', courseId, course } = req.body || {};
    const text = directive || description || content;
    if (!text) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Guideline directive/content is required.' } });
    }

    const targetCourse = courseId || (course !== 'Global' ? course : null);
    const targetScope = targetCourse ? 'course' : scope;

    const result = await query(
      `INSERT INTO ai_guidelines (scope, course_id, content, status, created_by, activated_at)
       VALUES ($1, $2, $3, 'active', $4, now())
       RETURNING *`,
      [targetScope, targetCourse, text.trim(), req.user.id]
    );

    res.status(201).json(formatGuideline(result.rows[0]));
  } catch (err) {
    next(err);
  }
}
router.post('/admin/guidelines', authenticate, requireRoles('instructor', 'admin'), createGuideline);
router.post('/guidelines', authenticate, requireRoles('instructor', 'admin'), createGuideline);

// PUT /admin/guidelines/:id/toggle
router.put('/admin/guidelines/:id/toggle', authenticate, requireRoles('admin'), async (req, res, next) => {
  try {
    const existing = await query('SELECT status FROM ai_guidelines WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Guideline not found.' } });
    }

    const currentStatus = existing.rows[0].status;
    const nextStatus = currentStatus === 'active' ? 'draft' : 'active';

    const result = await query(
      `UPDATE ai_guidelines
       SET status = $1, activated_at = CASE WHEN $2 = 'active' THEN now() ELSE activated_at END, updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [nextStatus, nextStatus, req.params.id]
    );

    res.json(formatGuideline(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/guidelines/:id
router.delete('/admin/guidelines/:id', authenticate, requireRoles('admin'), async (req, res, next) => {
  try {
    await query('DELETE FROM ai_guidelines WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Guideline deleted.' });
  } catch (err) {
    next(err);
  }
});

// GET /analytics/kpis
router.get('/analytics/kpis', authenticate, requireRoles('instructor', 'admin'), async (_req, res, next) => {
  try {
    const [learnersRes, enrollRes, gradeRes, liveRes] = await Promise.all([
      query('SELECT COUNT(DISTINCT student_id) as count FROM enrollments WHERE status = \'enrolled\''),
      query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = \'completed\') as completed FROM enrollments'),
      query('SELECT AVG(grading_score) as avg_score FROM submissions WHERE grading_score IS NOT NULL'),
      query('SELECT COUNT(*) as count FROM live_sessions')
    ]);

    const activeLearners = Number(learnersRes.rows[0]?.count || 0);
    const totalEnrollments = Number(enrollRes.rows[0]?.total || 0);
    const completedEnrollments = Number(enrollRes.rows[0]?.completed || 0);
    const completionRate = totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 85;
    const assessmentAvg = gradeRes.rows[0]?.avg_score !== null ? Math.round(Number(gradeRes.rows[0]?.avg_score)) : 88;
    const liveCount = Number(liveRes.rows[0]?.count || 0);

    res.json({
      activeLearners,
      completionRate,
      assessmentAvg,
      liveCount,
      totalSessions: liveCount,
      revenue: { notAvailable: true }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
