import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { authenticate, requireRoles } from '../middleware/auth.js';

const router = Router();

function publicUser(u) {
  return {
    id: String(u.id),
    _id: String(u.id),
    email: u.email,
    name: u.name,
    role: u.role,
    avatar: u.avatar || null,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at
  };
}

// GET / (list users)
router.get('/', authenticate, requireRoles('instructor', 'admin'), async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, role, avatar, created_at, last_login_at
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`
    );
    res.json(result.rows.map(publicUser));
  } catch (err) {
    next(err);
  }
});

// GET /:id (user details with learning stats)
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && String(req.user.id) !== String(req.params.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to view this profile.' } });
    }

    const userRes = await query(
      `SELECT id, name, email, role, avatar, created_at, last_login_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    }

    const user = userRes.rows[0];

    const [progRes, enrRes, subRes] = await Promise.all([
      query('SELECT lesson_id FROM lesson_progress WHERE user_id = $1', [user.id]),
      query("SELECT course_id FROM enrollments WHERE student_id = $1 AND status = 'enrolled'", [user.id]),
      query(
        `SELECT assessment_id, grading_score
         FROM submissions
         WHERE student_id = $1 AND kind = 'assessment' AND attempt_status = 'submitted'`,
        [user.id]
      )
    ]);

    res.json({
      ...publicUser(user),
      completed_lessons: progRes.rows.map((p) => String(p.lesson_id)),
      enrolled_courses: enrRes.rows.map((e) => String(e.course_id)),
      completed_tasks: subRes.rows.map((s) => ({
        task_id: String(s.assessment_id),
        score: s.grading_score !== null ? Number(s.grading_score) : null
      }))
    });
  } catch (err) {
    next(err);
  }
});

// PUT /:id/role and PATCH /:id/role
async function updateRoleHandler(req, res, next) {
  try {
    const { role } = req.body || {};
    if (!['student', 'instructor', 'admin'].includes(role)) {
      return res.status(400).json({ error: { code: 'INVALID_ROLE', message: 'Role must be student, instructor, or admin.' } });
    }

    const result = await query(
      `UPDATE users
       SET role = $1, updated_at = now()
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, name, email, role, avatar`,
      [role, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    }

    res.json(publicUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
}
router.put('/:id/role', authenticate, requireRoles('admin'), updateRoleHandler);
router.patch('/:id/role', authenticate, requireRoles('admin'), updateRoleHandler);

// PUT /:id/profile and PATCH /:id/profile
async function updateProfileHandler(req, res, next) {
  try {
    if (req.user.role !== 'admin' && String(req.user.id) !== String(req.params.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot update another user profile.' } });
    }

    const { name, avatar, password } = req.body || {};
    const existing = await query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    }

    const u = existing.rows[0];
    const newName = name !== undefined ? name.trim() : u.name;
    const newAvatar = avatar !== undefined ? avatar : u.avatar;
    let newHash = u.password_hash;
    if (password && password.length >= 6) {
      newHash = await bcrypt.hash(password, 12);
    }

    const result = await query(
      `UPDATE users
       SET name = $1, avatar = $2, password_hash = $3, updated_at = now()
       WHERE id = $4
       RETURNING id, name, email, role, avatar`,
      [newName, newAvatar, newHash, req.params.id]
    );

    res.json(publicUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
}
router.put('/:id/profile', authenticate, updateProfileHandler);
router.patch('/:id/profile', authenticate, updateProfileHandler);

// GET /:id/results
router.get('/:id/results', authenticate, async (req, res, next) => {
  try {
    const results = await query(
      `SELECT qr.*, a.title as task_title
       FROM quiz_results qr
       LEFT JOIN assessments a ON a.id::text = qr.task_id
       WHERE qr.student_id = $1`,
      [req.params.id]
    );
    res.json(results.rows);
  } catch (err) {
    next(err);
  }
});

// POST /:userId/lessons/:lessonId/toggle and POST /:id/toggle-lesson
async function toggleLessonHandler(req, res, next) {
  try {
    const userId = req.params.userId || req.params.id || req.user.id;
    const lessonId = req.params.lessonId || req.body?.lessonId;

    if (req.user.role !== 'admin' && String(req.user.id) !== String(userId)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot modify progress for other users.' } });
    }

    const lessonRes = await query('SELECT course_id FROM lessons WHERE id = $1', [lessonId]);
    if (lessonRes.rows.length === 0) {
      return res.status(404).json({ error: { code: 'LESSON_NOT_FOUND', message: 'Lesson not found.' } });
    }
    const courseId = lessonRes.rows[0].course_id;

    const existingProg = await query('SELECT id FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2', [userId, lessonId]);
    if (existingProg.rows.length > 0) {
      await query('DELETE FROM lesson_progress WHERE id = $1', [existingProg.rows[0].id]);
    } else {
      await query(
        `INSERT INTO lesson_progress (user_id, lesson_id, course_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, lesson_id) DO NOTHING`,
        [userId, lessonId, courseId]
      );
    }

    const updatedProg = await query('SELECT lesson_id FROM lesson_progress WHERE user_id = $1', [userId]);
    res.json({
      success: true,
      completed_lessons: updatedProg.rows.map((p) => String(p.lesson_id))
    });
  } catch (err) {
    next(err);
  }
}
router.post('/:userId/lessons/:lessonId/toggle', authenticate, toggleLessonHandler);
router.post('/:id/toggle-lesson', authenticate, toggleLessonHandler);

// DELETE /:id
router.delete('/:id', authenticate, requireRoles('admin'), async (req, res, next) => {
  try {
    await query('UPDATE users SET deleted_at = now() WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;
